#!/usr/bin/env node
import path from 'node:path';
import { loadConfig } from '../lib/config.js';
import { applyDisclosurePolicy, buildSessionProofPack, ledgerFromDisclosureResult, markDisclosureResultCommitted } from '../lib/disclosure.js';
import { listTurns, loadSession, readJson, writeJson } from '../lib/session.js';

const event = await readStdinJson();
const cwd = event?.cwd;
await loadConfig({ cwd });
const sessionId = event?.session_id;

const session = await loadSession({ cwd, sessionId });
const turns = await listTurns({ dir: session.dir });

if (turns.length === 0) process.exit(0);

const outboundLines = [];

for (const t of turns) {
  const ledgerPath = path.join(session.dir, `turn-${t}.json`);
  const ledger = await readJson(ledgerPath);
  if (!ledger) continue;

  if (ledger.phase === 'finalized') continue;

  if (ledger.receipt?.receipt_id) {
    const { local_private, ...ledgerWithoutOriginal } = ledger;
    void local_private;
    const finalized = {
      ...ledgerWithoutOriginal,
      phase: 'finalized',
      finalized_at: new Date().toISOString(),
    };
    await writeJson(ledgerPath, finalized);
    outboundLines.push(formatReceiptLine(t, finalized));
    continue;
  }

  const originalText = ledger?.local_private?.original_text ?? ledger.sanitized_text ?? '';
  const result = await applyDisclosurePolicy({
    text: originalText,
    session,
    cwd,
    boundary: defaultClaudeBoundary(),
    previousReceiptHash: session.state.lastReceiptHash,
    previousTokenHash: session.state.lastTokenHash,
    intentBinding: intentBindingFromSession(session),
    proofStage: 'stop_backfill',
  });
  const finalized = {
    ...ledgerFromDisclosureResult({
      turn: t,
      phase: 'finalized',
      result,
      originalText: null,
      referencedTokens: ledger.referenced_tokens ?? [],
    }),
    finalized_at: new Date().toISOString(),
  };
  await writeJson(ledgerPath, finalized);
  await markDisclosureResultCommitted({ session, result });
  outboundLines.push(formatReceiptLine(t, finalized));
}

const packResult = await buildSessionProofPack({ session });
if (packResult) {
  const packLine = `📦 ProofPack written: ${packResult.path}`;
  outboundLines.push(packLine);
  process.stderr.write(packLine + '\n');
}

if (outboundLines.length === 0) process.exit(0);

process.stdout.write(
  JSON.stringify({
    decision: 'approve',
    reason: outboundLines.join('\n'),
    continue: true,
    suppressOutput: false,
    systemMessage: outboundLines.join('\n'),
  }),
);

process.exit(0);

function formatReceiptLine(turn, ledger) {
  const claims = ledger.receipt.public_claims;
  const anchor = ledger.anchor ?? { anchored: false, reason: 'no anchor configured' };
  const anchorLine = anchor.anchored
    ? anchor.type === 'evm'
      ? `anchored on EVM ${anchor.tx_hash} block=${anchor.block_number}`
      : `anchored on HCS ${anchor.tx_id} seq=${anchor.sequence_number}`
    : anchor.error
      ? `anchor failed: ${anchor.error}`
      : `anchor ${anchor.reason || 'skipped'}`;
  const network = anchor.network || process.env.HEDERA_NETWORK || 'testnet';
  const topicId = anchor.topic_id || process.env.HEDERA_TOPIC_ID;
  const urls = [];
  if (anchor.anchored && anchor.hashscan_url) urls.push(anchor.hashscan_url);
  if (anchor.anchored && anchor.type === 'hcs' && topicId) urls.push(`https://hashscan.io/${network}/topic/${topicId}`);
  const urlBlock = urls.length ? `\n   ${urls.join('\n   ')}` : '';
  const line = `📜 Turn ${turn}: receipt ${ledger.receipt.receipt_id} (${claims.policy_id}, ${claims.protection_engine_id}, ${anchorLine})${urlBlock}`;
  process.stderr.write(line + '\n');
  return line;
}

function defaultClaudeBoundary() {
  return {
    destination: process.env.ZEROH_DESTINATION || 'anthropic_claude_api',
    model: process.env.ZEROH_MODEL || 'claude-code',
    retention: process.env.ZEROH_RETENTION || 'unknown',
    destination_jurisdiction: process.env.ZEROH_DESTINATION_JURISDICTION || 'US',
  };
}

function intentBindingFromSession(session) {
  return session.state.vi ? {
    l1_hash: session.state.vi.l1_hash,
    l2_hash: session.state.vi.l2_hash,
    l2_nonce: session.state.vi.l2_nonce,
    mandate_aud: session.state.vi.mandate_aud,
    agent_jwk_kid: session.state.vi.agent_jwk_kid,
    scope_summary: session.state.vi.scope_summary,
    expiry: session.state.vi.expiry,
  } : null;
}

async function readStdinJson() {
  if (process.stdin.isTTY) return null;
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
