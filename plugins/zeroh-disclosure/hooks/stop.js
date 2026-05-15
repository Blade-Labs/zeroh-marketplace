#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config.js';
import { prepareDisclosure } from '../lib/receipt.js';
import { buildProofPack } from '../lib/proofpack.js';
import { anchorIntentToHederaMessage } from '../lib/anchor.js';
import { isAnchorEnabled, submitToHcs } from '../lib/hedera-anchor.js';
import { isEvmAnchorEnabled, submitEvmAnchor } from '../lib/evm-anchor.js';
import { hmacKeyBytes, listTurns, loadSession, readJson, writeJson, writeProofPack } from '../lib/session.js';

const event = await readStdinJson();
const cwd = event?.cwd;
await loadConfig({ cwd });
const sessionId = event?.session_id;

const session = await loadSession({ cwd, sessionId });
const turns = await listTurns({ dir: session.dir });

if (turns.length === 0) process.exit(0);

const unfinished = [];
for (const t of turns) {
  const ledgerPath = path.join(session.dir, `turn-${t}.json`);
  const ledger = await readJson(ledgerPath);
  if (!ledger) continue;
  if (ledger.phase === 'finalized') continue;
  unfinished.push({ t, ledgerPath, ledger });
}

if (unfinished.length === 0) process.exit(0);

const outboundLines = [];
const receipts = [];
let prevReceiptHash = session.state.lastReceiptHash;
let prevTokenHash = session.state.lastTokenHash;

// If a Verifiable Intent mandate is active in the session, surface a compact
// binding into every receipt's boundary + public_claims so an auditor can
// reconstruct "this disclosure was enforced under that user authorization".
// The full constraint list stays in state.vi (recoverable from the mandate
// itself) — only the binding handles travel in each receipt.
const intentBinding = session.state.vi ? {
  l1_hash: session.state.vi.l1_hash,
  l2_hash: session.state.vi.l2_hash,
  l2_nonce: session.state.vi.l2_nonce,
  mandate_aud: session.state.vi.mandate_aud,
  agent_jwk_kid: session.state.vi.agent_jwk_kid,
  scope_summary: session.state.vi.scope_summary,
  expiry: session.state.vi.expiry,
} : null;

for (const { t, ledgerPath, ledger } of unfinished) {
  const originalText = ledger?.local_private?.original_text ?? ledger.sanitized_text ?? '';
  const result = await prepareDisclosure({
    text: originalText,
    boundary: {
      destination: process.env.ZEROH_DESTINATION || 'anthropic_claude_api',
      model: process.env.ZEROH_MODEL || 'claude-code',
      retention: process.env.ZEROH_RETENTION || 'unknown',
      destination_jurisdiction: process.env.ZEROH_DESTINATION_JURISDICTION || 'US',
    },
    wallet: session.wallet,
    previousReceiptHash: prevReceiptHash,
    previousTokenHash: prevTokenHash,
    hmacKeyBytes: hmacKeyBytes(session.state),
    intentBinding,
  });

  // Anchor: HCS-primary, EVM-fallback. HCS gives us topic semantics
  // (sequence numbers, topic-level filtering) and is preferred where gRPC
  // is reachable. EVM via Hashio works over HTTPS-only egress (sandboxes,
  // restricted CI) and uses the same receipt_hash as the on-chain payload.
  let anchor = { anchored: false, type: 'none', reason: 'no anchor configured' };
  let hcsAttempt = null;
  if (isAnchorEnabled()) {
    try {
      const hcs = await submitToHcs(anchorIntentToHederaMessage(result.anchor_intent));
      hcsAttempt = { ...hcs, type: 'hcs' };
      if (hcs.anchored) anchor = hcsAttempt;
    } catch (e) {
      hcsAttempt = { anchored: false, type: 'hcs', error: String(e?.message ?? e) };
    }
  }
  if (!anchor.anchored && isEvmAnchorEnabled()) {
    const evm = await submitEvmAnchor(result.receipt.receipt_hash);
    if (evm.anchored) {
      anchor = hcsAttempt ? { ...evm, hcs_attempt: hcsAttempt } : evm;
    } else if (hcsAttempt) {
      anchor = { anchored: false, type: 'none', hcs_attempt: hcsAttempt, evm_attempt: evm };
    } else {
      anchor = evm;
    }
  } else if (hcsAttempt && !anchor.anchored) {
    anchor = hcsAttempt;
  }

  // Drop the original text once the receipt is built — the receipt holds an
  // HMAC commitment to it, and we don't want raw PII lingering on disk after
  // finalization.
  const { local_private, ...ledgerWithoutOriginal } = ledger;
  void local_private;
  const finalized = {
    ...ledgerWithoutOriginal,
    phase: 'finalized',
    finalized_at: new Date().toISOString(),
    receipt: {
      receipt_id: result.receipt.receipt_id,
      receipt_hash: result.receipt.receipt_hash,
      public_claims: result.receipt.public_claims,
      compact_sdjwt: result.receipt.sdjwt.compact,
      disclosure_manifest: result.receipt.disclosure_manifest,
      presentations: result.receipt.presentations,
    },
    token: result.token,
    anchor_intent: result.anchor_intent,
    anchor,
  };

  await writeJson(ledgerPath, finalized);
  receipts.push(finalized);

  prevReceiptHash = result.receipt.receipt_hash;
  prevTokenHash = result.token.token_hash;

  const anchorLine = anchor.anchored
    ? anchor.type === 'evm'
      ? `anchored on EVM ${anchor.tx_hash} block=${anchor.block_number}`
      : `anchored on HCS ${anchor.tx_id} seq=${anchor.sequence_number}`
    : anchor.error
      ? `anchor failed: ${anchor.error}`
      : 'anchor skipped';
  const network = anchor.network || process.env.HEDERA_NETWORK || 'testnet';
  const topicId = anchor.topic_id || process.env.HEDERA_TOPIC_ID;
  const urls = [];
  if (anchor.anchored && anchor.hashscan_url) urls.push(anchor.hashscan_url);
  if (anchor.anchored && anchor.type === 'hcs' && topicId) urls.push(`https://hashscan.io/${network}/topic/${topicId}`);
  const urlBlock = urls.length ? `\n   ${urls.join('\n   ')}` : '';
  const line = `📜 Turn ${t}: receipt ${result.receipt.receipt_id} (${anchorLine})${urlBlock}`;
  outboundLines.push(line);
  process.stderr.write(line + '\n'); // debug copy
}

session.state.lastReceiptHash = prevReceiptHash;
session.state.lastTokenHash = prevTokenHash;
session.state.updated_at = new Date().toISOString();
await writeJson(session.statePath, session.state);

const pack = await buildProofPack(
  receipts.map((r) => ({ public_claims: r.receipt.public_claims })),
  { audience: 'regulator', period: `session:${session.state.sid || sessionId || 'default'}` },
);
const packPath = await writeProofPack({ dir: session.dir, turn: unfinished.at(-1).t, proofpack: pack });
const packLine = `📦 ProofPack written: ${packPath}`;
outboundLines.push(packLine);
process.stderr.write(packLine + '\n');

// UserPromptSubmit gets text into the transcript via {decision:"block", reason}.
// Stop can't block (that would force another agent loop), so we use the same
// reason-as-message channel with decision:"approve" — which the docs imply
// renders the explanation to the user without forcing continuation.
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

void fs;
