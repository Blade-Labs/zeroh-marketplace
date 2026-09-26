// SPDX-License-Identifier: AGPL-3.0-only

// Per-session state under <ZEROH_HOME>/projects/<encoded project path>/
// sessions/<id> (D-15): turn counter, signing key and turn ledgers; and the
// one project root rule. Nothing is written into the project folder. The key
// that makes the receipts' value commitments lives apart, under
// <ZEROH_HOME>/session-keys (see commitmentKeyPath).
import {
  promises as fs,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import {
  notWritable,
  readJsonOr,
  writePrivateFile,
  writePrivateJson,
} from './private-fs.js';
import { TOKEN_RE } from './token-pattern.js';
import path from 'node:path';
import os from 'node:os';
import { base64UrlToBytes, randomBytes } from './crypto.js';
import { loadOrCreateSigningKey } from './signing-key.js';
import { projectKey, zerohHome } from './vault.js';

// The core hooks run on Node built-ins only: a plugin install copies this
// directory without node_modules.

// Sessions live under <ZEROH_HOME>/projects/<encoded project path>/sessions/<sid>/,
// beside Claude Code's own ~/.claude/projects/<encoded project path>/<sid>.jsonl:
//   state.json    — { turnCount, lastReceiptHash, lastTokenHash }
//   signing-key.json — public half of the receipt signing key (key id + JWK)
//   signing-key.private.json — private JWK (P-256). Sensitive; lives only on disk.
//   turn-<n>.json — per-turn ledger (prompt commitment, findings, masked text, replacements, receipt)
//   session.bundle.json — the session's receipt bundle, rewritten by the Stop hook.

// The one project root rule: Claude Code's project dir, else the nearest
// folder from `start` (a hook event's cwd, else this process's working
// directory) up that ZeroH knows as a project (ZEROH_HOME/projects.json lists
// it, or it has a folder under ZEROH_HOME/projects), else `start`.
// Hooks, the CLI, the command scripts and the MCP server all resolve it this
// way, so sessions, the vault and allow rules land in the same place from
// any subdirectory. An explicit --cwd on the CLI wins over all of these.
export function projectRootFromEnv(start, env = process.env) {
  if (env.CLAUDE_PROJECT_DIR) return env.CLAUDE_PROJECT_DIR;
  const from = path.resolve(start || process.cwd());
  const home = path.resolve(zerohHome(env));
  const registered = new Set(
    (readJsonOr(path.join(home, 'projects.json'))?.projects ?? [])
      .map((entry) => entry?.root)
      .filter((root) => typeof root === 'string')
      .map((root) => path.resolve(root)),
  );
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (registered.has(dir)) return dir;
    if (isDirectory(path.join(home, 'projects', encodeProjectPath(dir)))) {
      return dir;
    }
    if (path.dirname(dir) === dir) return from;
  }
}

// A project's folder name under ZEROH_HOME/projects, encoded as Claude Code
// 2.1.283 names its ~/.claude/projects folders so the two line up: the
// absolute path with every character other than A-Z, a-z and 0-9 replaced by
// "-"; a name longer than 200 characters is cut to 200 and gets "-" and a
// base-36 hash of the path.
export function encodeProjectPath(root, pathImpl = path) {
  const resolved = pathImpl.resolve(root);
  const name = resolved.replace(/[^a-zA-Z0-9]/gu, '-');
  if (name.length <= 200) return name;
  let hash = 0;
  for (let index = 0; index < resolved.length; index += 1) {
    hash = ((hash << 5) - hash + resolved.charCodeAt(index)) | 0;
  }
  return `${name.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}

// Everything ZeroH keeps for one project (sessions and receipts, the allow
// list): <ZEROH_HOME>/projects/<encoded project path>.
export function projectDataDir(root, env = process.env) {
  return path.join(
    zerohHome(env),
    'projects',
    encodeProjectPath(path.resolve(root || projectRootFromEnv(undefined, env))),
  );
}

function isDirectory(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// The one session id rule outside a hook event (commands, the CLI, the MCP
// server): Claude Code's CLAUDE_CODE_SESSION_ID, else the older
// CLAUDE_SESSION_ID, else null.
export function envSessionId(env = process.env) {
  return env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || null;
}

export { notWritable };

// Where ZeroH keeps a project's session files (D-15): never in the project.
export function projectStateDir(root, env = process.env) {
  return projectDataDir(root, env);
}

// The sessions folder of a project, for readers (receipts, reports).
export function sessionsRoots(root, env = process.env) {
  return [path.join(projectDataDir(root, env), 'sessions')];
}

// The session folder for a project root (a hook's resolved root, else the
// one project root rule) and a session id (else the environment's, else
// "default").
export function sessionDir(cwd, sessionId, env = process.env) {
  const sid = sanitizeSid(sessionId || envSessionId(env) || 'default');
  return path.join(projectStateDir(cwd, env), 'sessions', sid);
}

// --- commitment keys --------------------------------------------------------

// Receipts commit to each masked value with HMAC(key, {type, value}). The key
// is kept under ZEROH_HOME, not in the project folder next to the receipts
// (which may be synced or shared): receipts alone never allow guessing a
// short value such as a phone number. `vault clear` and retention delete the
// keys, and the commitments become noise.
function commitmentKeyDir(root, env = process.env) {
  return path.join(
    zerohHome(env),
    'session-keys',
    projectKey(path.resolve(root)),
  );
}

export function commitmentKeyPath(root, sessionId, env = process.env) {
  return path.join(
    commitmentKeyDir(root, env),
    `${sanitizeSid(sessionId || 'default')}.key`,
  );
}

function loadCommitmentKey(root, sid, { legacy = null, env = process.env }) {
  const file = commitmentKeyPath(root, sid, env);
  try {
    const key = readFileSync(file);
    if (key.length === 32) return { key, persisted: true };
  } catch {
    // Created below.
  }
  const key = legacy ? Buffer.from(legacy) : Buffer.from(randomBytes(32));
  try {
    writePrivateFile(file, key);
    return { key, persisted: true };
  } catch {
    // A read-only ZEROH_HOME: the key lives for this process only.
    return { key, persisted: false };
  }
}

export function removeCommitmentKey(root, sessionId, env = process.env) {
  try {
    rmSync(commitmentKeyPath(root, sessionId || 'default', env), {
      force: true,
    });
    return true;
  } catch {
    return false;
  }
}

// Deletes this project's commitment keys older than `maxAgeMs` (all of them
// without an age), except `keep`. Returns how many it deleted.
export function pruneCommitmentKeys(
  root,
  { env = process.env, maxAgeMs = null, keep = null, now = Date.now() } = {},
) {
  const dir = commitmentKeyDir(root, env);
  const keepName = keep ? `${sanitizeSid(keep)}.key` : null;
  let removed = 0;
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.endsWith('.key') || name === keepName) continue;
    const file = path.join(dir, name);
    try {
      if (maxAgeMs !== null && now - statSync(file).mtimeMs <= maxAgeMs) {
        continue;
      }
      rmSync(file, { force: true });
      removed += 1;
    } catch {
      // Removed by another process.
    }
  }
  return removed;
}

export function sanitizeSid(sid) {
  return String(sid)
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 64);
}

// ZeroH's folders are private: directories 0700 (files 0600, see
// lib/private-fs.js). Nothing lives in the project, so no .gitignore.
export async function ensureDir(dir) {
  ensurePrivateDirSync(dir);
}

export function ensurePrivateDirSync(dir) {
  mkdirSync(path.resolve(dir), { recursive: true, mode: 0o700 });
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

// Atomic and private (lib/private-fs.js).
export async function writeJson(p, value) {
  ensurePrivateDirSync(path.dirname(p));
  writePrivateJson(p, value);
}

// The session's state, signing key and commitment key. When ZEROH_HOME can't
// be written, the session lives in a private temporary folder that is removed when the
// process exits (`ephemeral`): masking and stopping work, no receipts are
// kept.
export async function loadSession({ cwd, sessionId, env = process.env }) {
  const resolvedSid = sanitizeSid(sessionId || envSessionId() || 'default');
  const root = path.resolve(cwd || projectRootFromEnv());
  try {
    return await openSession({
      dir: sessionDir(root, resolvedSid, env),
      root,
      sid: resolvedSid,
      env,
    });
  } catch (error) {
    if (!notWritable(error)) throw error;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'zeroh-session-'));
    process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
    return {
      ...(await openSession({ dir, root, sid: resolvedSid, env })),
      ephemeral: true,
    };
  }
}

async function openSession({ dir, root, sid, env }) {
  await ensureDir(dir);
  const statePath = path.join(dir, 'state.json');
  let state = await readJson(statePath);
  const legacy = state?.hmacKeyB64u
    ? base64UrlToBytes(state.hmacKeyB64u)
    : null;
  if (!state) {
    state = {
      sid,
      created_at: new Date().toISOString(),
      turnCount: 0,
      lastReceiptHash: null,
      lastTokenHash: null,
    };
    await writeJson(statePath, state);
  }
  const commitment = loadCommitmentKey(root, sid, { legacy, env });
  if (legacy && commitment.persisted) {
    // Written by an earlier version next to the receipts: moved out.
    delete state.hmacKeyB64u;
    await writeJson(statePath, state);
  }
  const signingKey = await loadOrCreateSigningKey({
    readJson,
    writeJson,
    publicPath: path.join(dir, 'signing-key.json'),
    privatePath: path.join(dir, 'signing-key.private.json'),
    keyId: `local:${hash32(state.sid || sid)}`,
  });
  // Keys written by earlier versions may carry the umask's mode.
  await fs.chmod(path.join(dir, 'signing-key.private.json'), 0o600);
  return {
    dir,
    root,
    state,
    statePath,
    signingKey,
    commitmentKey: commitment.key,
  };
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

export async function writeTurn({ dir, turn, payload }) {
  const p = path.join(dir, `turn-${turn}.json`);
  await writeJson(p, payload);
  return p;
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

// One bundle per session, replaced at every Stop: the session's disk use
// grows with its receipts, not with the square of its turns.
export async function writeReceiptBundle({ dir, bundle }) {
  const p = path.join(dir, 'session.bundle.json');
  await writeJson(p, bundle);
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
    if (!/^turn-\d+\.json$/.test(name) && !/^tool-.+\.json$/.test(name))
      continue;
    const record = await readJson(path.join(dir, name));
    const replacements =
      record?.replacements ||
      record?.fields?.flatMap((f) => f.replacements || []) ||
      [];
    for (const r of replacements) {
      if (r?.replacement && r?.entity_type)
        map.set(r.replacement, r.entity_type);
    }
  }
  return map;
}

export function extractTokens(text) {
  if (typeof text !== 'string') return [];
  return [...new Set(text.match(TOKEN_RE) || [])];
}

// The session's commitment key (a session from loadSession, or a state
// that still carries an older version's key).
export function hmacKeyBytes(session) {
  if (session?.commitmentKey) return new Uint8Array(session.commitmentKey);
  return base64UrlToBytes(session.hmacKeyB64u);
}

export function home() {
  return os.homedir();
}
