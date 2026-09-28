#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Stop: finalise and sign the turn's receipts, write the session's receipt
// bundle and receipt.html, and print one line when the turn that just ended
// had events.
import path from 'node:path';
import { loadConfig } from '../lib/config.js';
import { emit, projectDir, readStdinJson } from '../lib/hook-io.js';
import {
  applyDisclosurePolicy,
  buildSessionReceiptBundle,
  ledgerFromDisclosureResult,
  markDisclosureResultCommitted,
} from '../lib/disclosure.js';
import { listTurns, loadSession, readJson, writeJson } from '../lib/session.js';
import { cleanupStaleRunFiles } from '../lib/late-bind.js';
import {
  initializeRevealReceiptExtension,
  REVEAL_EXTENSION_MARKER,
} from '../lib/unmask.js';
import {
  formatStopReceiptLine,
  formatStopTokenLine,
  promptSentUnmasked,
  promptStopped,
  turnMaskedCount,
  writeSessionReceiptHtml,
} from '../lib/report.js';
import { updateSessionStatus } from '../lib/session-status.js';

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

const finalizedTurns = [];

for (const t of turns) {
  const ledgerPath = path.join(session.dir, `turn-${t}.json`);
  const ledger = await readJson(ledgerPath);
  if (!ledger) continue;

  if (ledger.phase === 'finalized') continue;
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
    await writeJson(ledgerPath, finalized);
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
  await writeJson(ledgerPath, finalized);
  await markDisclosureResultCommitted({ session, result });
  finalizedTurns.push({ turn: t, ledger: finalized, blocked, sentUnmasked });
}

// Every turn still gets a signed receipt, receipt.html and the session
// receipt bundle; the screen hears about a turn only when it has something to
// say, and only about the turn that just ended (T-31): an earlier stopped
// turn finalised here is in the receipt, and was told when it was stopped.
const currentTurn = Number(session.state.turnCount) || turns.at(-1);
const outboundLines = [];
if (finalizedTurns.length > 0) {
  const receiptView = await writeSessionReceiptHtml({ session });
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
    });
    if (seen) outboundLines.push(seen);
  }
}

await buildSessionReceiptBundle({ session });

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
  return status;
});

if (outboundLines.length === 0) process.exit(0);

emit({
  decision: 'approve',
  reason: outboundLines.join('\n'),
  continue: true,
  suppressOutput: false,
  systemMessage: outboundLines.join('\n'),
});

process.exit(0);
