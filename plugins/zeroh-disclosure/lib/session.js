import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { bytesToBase64Url, base64UrlToBytes, randomBytes } from './crypto.js';
import { loadOrCreateMockWallet } from './wallet/mock-wallet.js';
import { loadViWallet } from './wallet/vi-wallet.js';

// Sessions live under <project>/.zeroh/sessions/<sid>/ with:
//   state.json    — { hmacKeyB64u, turnCount, lastReceiptHash, lastTokenHash, walletAccountId }
//   wallet.json   — public part of the wallet (account + jwk)
//   wallet.key.json — private JWK (P-256). Sensitive; lives only on disk.
//   turn-<n>.json — per-turn ledger (prompt commitment, findings, masked text, replacements, receipt)
//   event-<n>.json — signed tool-action evidence event.
//   turn-<n>.proofpack.json — final ProofPack written by Stop hook.

export function projectRoot(cwd) {
  return cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

export function sessionDir(cwd, sessionId) {
  const sid = sanitizeSid(sessionId || process.env.CLAUDE_SESSION_ID || 'default');
  return path.join(projectRoot(cwd), '.zeroh', 'sessions', sid);
}

function sanitizeSid(sid) {
  return String(sid).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson(p) {
  try {
    const buf = await fs.readFile(p, 'utf8');
    return JSON.parse(buf);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function writeJson(p, value) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(value, null, 2));
}

export async function loadSession({ cwd, sessionId }) {
  const resolvedSid = sanitizeSid(sessionId || process.env.CLAUDE_SESSION_ID || 'default');
  const dir = sessionDir(cwd, resolvedSid);
  await ensureDir(dir);
  const statePath = path.join(dir, 'state.json');
  let state = await readJson(statePath);
  if (!state) {
    state = {
      sid: resolvedSid,
      created_at: new Date().toISOString(),
      hmacKeyB64u: bytesToBase64Url(randomBytes(32)),
      turnCount: 0,
      lastReceiptHash: null,
      lastTokenHash: null,
    };
    await writeJson(statePath, state);
  }
  // Wallet selection (Phase E.6): if a VI mandate is active in this session
  // AND the agent's private key file is configured, swap the receipt signer
  // for the L2-bound agent key. One key now signs both forward (L3) and
  // backward (ZH receipts). Failing loud beats silent fallback — if the user
  // turned VI on but didn't supply the key, that's a configuration error.
  let wallet;
  if (state.vi && process.env.ZEROH_VI_AGENT_KEY_FILE) {
    wallet = await loadViWallet({
      keyFile: process.env.ZEROH_VI_AGENT_KEY_FILE,
      boundJwk: null, // checked at SessionStart; trusting persisted state here
    });
  } else {
    wallet = await loadOrCreateMockWallet({
      readJson,
      writeJson,
      walletPath: path.join(dir, 'wallet.json'),
      privateJwkPath: path.join(dir, 'wallet.key.json'),
      accountId: process.env.HEDERA_OPERATOR_ID || `0.0.${hash32(state.sid || resolvedSid)}`,
      network: process.env.HEDERA_NETWORK || 'testnet',
    });
  }
  return { dir, state, statePath, wallet };
}

function hash32(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h % 9_999_999);
}

export async function bumpTurn({ statePath, state }) {
  state.turnCount = (state.turnCount ?? 0) + 1;
  state.updated_at = new Date().toISOString();
  await writeJson(statePath, state);
  return state.turnCount;
}

export async function bumpEvent({ statePath, state }) {
  state.eventCount = (state.eventCount ?? 0) + 1;
  state.updated_at = new Date().toISOString();
  await writeJson(statePath, state);
  return state.eventCount;
}

export async function writeTurn({ dir, turn, payload }) {
  const p = path.join(dir, `turn-${turn}.json`);
  await writeJson(p, payload);
  return p;
}

export async function writeEvent({ dir, sequence, payload }) {
  const p = path.join(dir, `event-${sequence}.json`);
  await writeJson(p, payload);
  return p;
}

export async function readTurn({ dir, turn }) {
  return readJson(path.join(dir, `turn-${turn}.json`));
}

export async function listTurns({ dir }) {
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((e) => /^turn-\d+\.json$/.test(e))
      .map((e) => Number(e.match(/^turn-(\d+)\.json$/)[1]))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export async function listEvents({ dir }) {
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((e) => /^event-\d+\.json$/.test(e))
      .map((e) => Number(e.match(/^event-(\d+)\.json$/)[1]))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export async function writeProofPack({ dir, turn, proofpack }) {
  const p = path.join(dir, `turn-${turn}.proofpack.json`);
  await writeJson(p, proofpack);
  return p;
}

// Walk the session dir and return a Map<token, entityType> covering every
// replacement recorded in any turn-*.json or tool-*.json file. Used by hooks
// to inject a token map into Claude's context.
export async function collectActiveTokens(dir) {
  const map = new Map();
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return map;
  }
  for (const name of entries) {
    if (!/^turn-\d+\.json$/.test(name) && !/^tool-.+\.json$/.test(name)) continue;
    const record = await readJson(path.join(dir, name));
    const replacements =
      record?.replacements ||
      record?.fields?.flatMap((f) => f.replacements || []) ||
      [];
    for (const r of replacements) {
      if (r?.replacement && r?.entity_type) map.set(r.replacement, r.entity_type);
    }
  }
  return map;
}

const TOKEN_RE = /\[[A-Z_]+-[0-9a-f]{6}\]/g;
export function extractTokens(text) {
  if (typeof text !== 'string') return [];
  return [...new Set(text.match(TOKEN_RE) || [])];
}

export function hmacKeyBytes(state) {
  return base64UrlToBytes(state.hmacKeyB64u);
}

export function home() {
  return os.homedir();
}
