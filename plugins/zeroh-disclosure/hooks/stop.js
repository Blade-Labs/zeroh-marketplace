#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { writeReceiptJson } from '../packages/zeroh-disclosure-core/receipt-sink.js';
// Stop: finalise and sign the turn's receipts, write the session's receipt
// bundle and receipt.html, and print one line when the turn that just ended
// had events.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../packages/zeroh-disclosure-core/config.js';
import { emit, projectDir, readStdinJson } from '../lib/hook-io.js';
import {
  applyDisclosurePolicy,
  buildSessionReceiptBundle,
  ledgerFromDisclosureResult,
  markDisclosureResultCommitted,
} from '../packages/zeroh-disclosure-core/disclosure.js';
import {
  listTurns,
  loadSession,
  readJson,
} from '../packages/zeroh-disclosure-core/session.js';
import { cleanupStaleRunFiles } from '../packages/shell-analysis/late-bind.js';
import {
  initializeRevealReceiptExtension,
  REVEAL_EXTENSION_MARKER,
} from '../packages/zeroh-disclosure-core/unmask.js';
import {
  formatStopReceiptLine,
  formatStopTokenLine,
  promptSentUnmasked,
  promptStopped,
  turnMaskedCount,
  writeSessionReceiptHtml,
} from '../packages/zeroh-disclosure-core/report.js';
import { updateSessionStatus } from '../packages/zeroh-disclosure-core/session-status.js';
import { verifyStopReceipts } from '../packages/zeroh-disclosure-core/stop-verifications.js';
import {
  signedTurnSummary,
  signTurnSummary,
} from '../packages/zeroh-disclosure-core/turn-summary.js';
import { takeDeferredNotices } from '../packages/zeroh-disclosure-core/unchecked.js';
import {
  acquireFileLock,
  releaseFileLock,
  Vault,
} from '../packages/zeroh-disclosure-core/vault.js';

const event = await readStdinJson();
try {
  cleanupStaleRunFiles();
} catch {
  // A file held open (Windows antivirus) is removed at the next start.
}
// One project root for sessions, vault and configuration (see projectDir).
const cwd = projectDir(event);
await loadConfig({ cwd });
const sessionId = event?.session_id;

const session = await loadSession({ cwd, sessionId });
const turns = await listTurns({ dir: session.dir });

if (turns.length === 0) process.exit(0);

// Read each ledger once, and reuse that snapshot for finalisation, the
// HTML receipt, the bundle and the status counts. The old path reopened
// every historical turn separately for each of those consumers.
// These small local files are read inside the watchdog's worker. Avoid one
// queued thread-pool request per historical turn: under competing hook/file
// I/O, that queue otherwise grows with the session before Stop can proceed.
const entries = turns.map((turn) => {
  const file = path.join(session.dir, `turn-${turn}.json`);
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    ledger = null;
  }
  return { turn, file, ledger };
});
const finalizedTurns = [];

for (const entry of entries) {
  const { turn: t, file: ledgerPath } = entry;
  let { ledger } = entry;
  if (!ledger) continue;

  if (ledger.phase === 'finalized') continue;
  // Refresh a pending turn immediately before finalising it, so the batch
  // read does not widen the window for a last tool's audit update.
  ledger = await readJson(ledgerPath);
  entry.ledger = ledger;
  if (!ledger || ledger.phase === 'finalized') continue;
  const blocked = promptStopped(ledger);
  const sentUnmasked = promptSentUnmasked(ledger);

  if (ledger.receipt?.receipt_id) {
    const { local_private, ...ledgerWithoutOriginal } = ledger;
    void local_private;
    const finalized = {
      ...ledgerWithoutOriginal,
      phase: 'finalized',
      finalized_at: new Date().toISOString(),
    };
    await writeReceiptJson(ledgerPath, finalized);
    entry.ledger = finalized;
    finalizedTurns.push({ turn: t, ledger: finalized, blocked, sentUnmasked });
    continue;
  }

  // Ledgers never hold the typed text, only its masked form.
  const result = await applyDisclosurePolicy({
    text: ledger.sanitized_text ?? '',
    session,
    cwd,
    previousReceiptHash: session.state.lastReceiptHash,
    previousTokenHash: session.state.lastTokenHash,
    proofStage: 'stop_backfill',
    publicClaimExtras: {
      unmask_receipt_extension: REVEAL_EXTENSION_MARKER,
    },
  });
  initializeRevealReceiptExtension(result.receipt);
  const finalized = {
    ...ledgerFromDisclosureResult({
      turn: t,
      phase: 'finalized',
      result,
      referencedTokens: ledger.referenced_tokens ?? [],
    }),
    finalized_at: new Date().toISOString(),
  };
  await writeReceiptJson(ledgerPath, finalized);
  entry.ledger = finalized;
  await markDisclosureResultCommitted({ session, result });
  finalizedTurns.push({ turn: t, ledger: finalized, blocked, sentUnmasked });
}

// The receipt signed at UserPromptSubmit covers the typed prompt; every
// other number the receipt shows (tool output and file reads masked, values
// sent, what passed unchecked) is signed here as the turn's summary, bound
// to that receipt (packages/zeroh-disclosure-core/turn-summary.js). The current turn is signed again at
// every Stop, so a count added after an earlier Stop is covered too.
const currentTurnNumber = Number(session.state.turnCount) || turns.at(-1);
const summaryTurns = new Set(finalizedTurns.map((entry) => entry.turn));
if (turns.includes(currentTurnNumber)) summaryTurns.add(currentTurnNumber);
for (const t of summaryTurns) {
  const ledgerPath = path.join(session.dir, `turn-${t}.json`);
  let lock = null;
  try {
    lock = acquireFileLock(`${ledgerPath}.lock`);
    const ledger = await readJson(ledgerPath);
    if (ledger?.phase !== 'finalized' || !ledger.receipt?.receipt_id) continue;
    ledger.turn_summary = await signTurnSummary({
      ledger,
      turn: t,
      signer: session.signingKey,
    });
    await writeReceiptJson(ledgerPath, ledger);
    const snapshot = entries.find((entry) => entry.turn === t);
    if (snapshot) snapshot.ledger = ledger;
    const entry = finalizedTurns.find((item) => item.turn === t);
    if (entry) entry.ledger = ledger;
  } catch {
    // Unsigned, the turn fails verification and the receipt says so.
  } finally {
    if (lock) releaseFileLock(lock);
  }
}

// The vault's value for a token, for the Stop line's previews (never a
// whole value, and never the start of a key or password; see stopPreview in
// packages/zeroh-disclosure-core/report.js). Opened once, only when a turn has tokens to show; a vault
// that can't be opened gives no previews.
let stopVault;
function stopValueOf() {
  if (stopVault === undefined) {
    try {
      stopVault = new Vault(session.root ?? cwd);
    } catch {
      stopVault = null;
    }
  }
  return stopVault ? (token) => stopVault.valueOf(token) : null;
}

// Every turn still gets a signed receipt, receipt.html and the session
// receipt bundle; the screen hears about a turn only when it has something to
// say, and only about the turn that just ended (T-31): an earlier stopped
// turn finalised here is in the receipt, and was told when it was stopped.
const currentTurn = Number(session.state.turnCount) || turns.at(-1);
const outboundLines = [];
if (finalizedTurns.length > 0) {
  const verifications = await verifyStopReceipts({ session, entries });
  const receiptView = await writeSessionReceiptHtml({
    session,
    turns: entries,
    verifications,
  });
  for (const entry of finalizedTurns) {
    if (entry.turn !== currentTurn) continue;
    const line = formatStopReceiptLine(
      entry.turn,
      entry.ledger,
      receiptView.path,
      { blocked: entry.blocked, sentUnmasked: entry.sentUnmasked },
    );
    if (!line) continue;
    outboundLines.push(line);
    const seen = formatStopTokenLine(entry.ledger, {
      blocked: entry.blocked,
      sentUnmasked: entry.sentUnmasked,
      valueOf: stopValueOf(),
    });
    if (seen) outboundLines.push(seen);
  }
}

await buildSessionReceiptBundle({ session, entries });

// Reconcile the status line's sent count from the signed summaries, never
// from hook-local increments that can race or be counted twice.
let signedSent = 0;
for (const { ledger } of entries) {
  const count = Number(signedTurnSummary(ledger)?.summary?.values_sent);
  if (Number.isInteger(count) && count > 0) signedSent += count;
}

// The status line's "masked" count: each turn is added once, when it is
// finalised.
updateSessionStatus({ cwd, sessionId }, (status) => {
  let masked = Number(status.masked) || 0;
  for (const entry of finalizedTurns) {
    masked += turnMaskedCount(entry.ledger, {
      blocked: entry.blocked,
      sentUnmasked: entry.sentUnmasked,
    });
  }
  status.masked = masked;
  status.sent = signedSent;
  return status;
});

// What the local proxy let through this turn without protecting it (it
// can't show a line itself): its "not protected" lines (packages/zeroh-disclosure-core/unchecked.js).
outboundLines.unshift(...(await takeDeferredNotices({ cwd, sessionId })));

if (outboundLines.length === 0) process.exit(0);

emit({
  decision: 'approve',
  reason: outboundLines.join('\n'),
  continue: true,
  suppressOutput: false,
  systemMessage: outboundLines.join('\n'),
});

process.exit(0);
