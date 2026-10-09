#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Fail closed (hooks/run.js): until the prompt is known to be safe to send,
// any error stops it (exit 2).
// UserPromptSubmit: check what the user typed. Through the proxy the prompt is
// masked on its way out; without it, a prompt holding a secret is sent as
// typed with a notice (rc.2 default), or, in `uncertain block` mode, stopped
// with a masked copy on the clipboard.
import {
  loadConfig,
  uncertainMode,
} from '../packages/zeroh-disclosure-core/config.js';
import { recordUnchecked } from '../packages/zeroh-disclosure-core/unchecked.js';
import { updateSessionStatus } from '../packages/zeroh-disclosure-core/session-status.js';
import {
  Vault,
  vaultProblem,
} from '../packages/zeroh-disclosure-core/vault.js';
import {
  exactValueHits,
  loadKnownSecrets,
  scrub,
} from '../packages/shell-analysis/secrets.js';
import {
  emit,
  markPromptCleared,
  projectDir,
  readStdinJson,
  stopPrompt,
} from '../lib/hook-io.js';
import {
  detectEntropyWarnings,
  detectSensitiveData,
} from '../packages/zeroh-disclosure-core/detector.js';
import {
  bumpTurn,
  collectActiveTokens,
  extractTokens,
  loadSession,
  notWritable,
  writeTurn,
} from '../packages/zeroh-disclosure-core/session.js';
import { firstNoticeThisTurn } from '../lib/format-audit.js';
import {
  NAMING_REMINDER,
  namingReminder,
} from '../packages/zeroh-disclosure-core/token-pattern.js';
import {
  applyDisclosurePolicy,
  ledgerFromDisclosureResult,
  markDisclosureResultCommitted,
} from '../packages/zeroh-disclosure-core/disclosure.js';
import {
  grantEndedNote,
  initializeRevealReceiptExtension,
  REVEAL_EXTENSION_MARKER,
} from '../packages/zeroh-disclosure-core/unmask.js';
import { UNSAVEABLE_REASON } from '../packages/zeroh-disclosure-core/restorable.js';
import { NOT_PROTECTED_LINE } from '../packages/zeroh-disclosure-core/protection-state.js';
import {
  collectSentValueNames,
  enforcePromptDecision,
} from '../lib/hook-steps/user-prompt-submit/process-prompt-values.js';
import { collectPromptNotices } from '../lib/hook-steps/user-prompt-submit/collect-prompt-notices.js';
import { unmaskedPromptNoticeContext } from '../lib/hook-steps/user-prompt-submit/unmasked-notice.js';
import {
  handlePromptPrelude,
  passPromptUnchecked,
} from '../lib/hook-steps/user-prompt-submit/prompt-prelude.js';
import { createPromptOutput } from '../lib/hook-steps/user-prompt-submit/prompt-output.js';
import { resolvePromptRouting } from '../lib/hook-steps/user-prompt-submit/prompt-routing.js';

const event = await readStdinJson();
const userPrompt = event?.prompt ?? event?.user_prompt ?? '';
if (typeof userPrompt !== 'string' || userPrompt.length === 0) {
  process.exit(0);
}
if (await handlePromptPrelude({ event, userPrompt })) process.exit(0);
const passUnchecked = (reason, suffix = '') =>
  passPromptUnchecked(event, reason, suffix);
async function passesUncertain() {
  try {
    await loadConfig({ cwd: projectDir(event) });
    return uncertainMode() === 'pass';
  } catch {
    return true;
  }
}
let result;
let known;
let knownHits;
let fileHits;
let promptTokens;
// One project root for sessions, vault and configuration (see projectDir).
const cwd = projectDir(event);
await loadConfig({ cwd });
// What happens to a typed secret the proxy can't mask (the `uncertain` mode).
const TYPED_SECRETS =
  uncertainMode() === 'block'
    ? 'typed secrets are stopped instead'
    : NOT_PROTECTED_LINE;
const sessionId = event?.session_id;
const root = projectDir(event);
let vault = null;
let vaultFailure = null;
function openPromptVault() {
  try {
    vault = new Vault(root, { sessionId: event?.session_id });
  } catch (error) {
    // A clean prompt can proceed: PostToolUse will withhold any output it cannot
    // mask. Anything that already needs tokenization or restoration is blocked.
    vaultFailure = error;
  }
}
const { proxyOn, routingNotice, stopReason, switchedNow } =
  await resolvePromptRouting({ event, typedSecrets: TYPED_SECRETS });
// Without the proxy nothing can mask the prompt. In the default `uncertain`
// mode (pass; owner rule 2026-09-27) a prompt holding a secret is sent as
// typed and the user is told in one line; `uncertain block` stops it as
// before (lib/stop-message.js).
const passUnmasked = !proxyOn && uncertainMode() === 'pass';
// Every prompt — clean, tokenized re-submit, or PII-bearing — gets a turn and
// a receipt. The receipt is the deliverable: it records that the policy was
// applied and what it observed, signed locally. Masking is one
// possible outcome; "policy applied, 0 findings" is just as valid a proof.

const session = await loadSession({ cwd, sessionId });
openPromptVault();
// The notices shown above this prompt, each only when it is news (T-25): an
// unmask grant on the first prompt after it starts, again when 5 minutes or
// less remain, and once when it ends; the routing problem once.
// Kinds whose grant ended since the last prompt: the model is told its
// history shows them as tokens again (grantEndedNote).
const endedGrantKinds = [];
const grantStatus = collectPromptNotices(session.state, {
  vaultFailure,
  routingNotice,
  root,
  sessionId,
  endedGrantKinds,
});
const grantEndedContext = grantEndedNote(endedGrantKinds);
const {
  distinctSentValues,
  emitBlock,
  emitEntropyWarning,
  emitPromptNotice,
  entropyWarningLine,
  mentionedFileSecrets,
  recordPromptTokens,
  sentAsTypedDecision,
  unsavedValues,
} = createPromptOutput({
  getRuntime: () => ({
    fileHits,
    grantEndedContext,
    grantStatus,
    known,
    knownHits,
    promptTokens,
    result,
    root,
    sessionId,
    stopReason,
    switchedNow,
    userPrompt,
    vault,
  }),
});

const turn = await bumpTurn(session);
// The status line (lib/statusline.js): this turn, and whether the proxy masks
// what the user types in this session.
updateSessionStatus({ cwd, sessionId }, (status) => {
  status.turn = turn;
  status.proxy = proxyOn ? 'on' : (stopReason ?? 'off');
  return status;
});
const tokens = extractTokens(userPrompt);
const entropyWarnings = detectEntropyWarnings(userPrompt);
const receiptWarnings = entropyWarnings.map(({ name, entropy, length }) => ({
  type: 'ENTROPY_WARNING',
  name,
  entropy,
  length,
  disposition: 'sent_as_is',
}));
// Record the policy engine's tokens so a later restore resolves exactly them,
// and look for this project's known secrets and @-mentioned files.
known = loadKnownSecrets(root);
knownHits = known.filter((k) => userPrompt.includes(k.value));
// A value ZeroH masked earlier (from any source) typed or pasted back bare.
if (vault) {
  for (const hit of exactValueHits(userPrompt, { vault, known })) {
    if (hit.source.startsWith('known:')) continue;
    knownHits.push({
      name: 'a value ZeroH masked earlier',
      source: 'the vault',
      value: hit.value,
      type: hit.type,
      vaultSource: hit.source,
    });
  }
}
fileHits = proxyOn || !vault ? [] : mentionedFileSecrets(userPrompt, root);
// What this hook does with the prompt, recorded in the signed receipt: the
// proxy masks what it found and sends it; without the proxy any finding stops
// the prompt. A clean prompt keeps the policy's own decision.
function enforcedDecision(policyDecision, findings) {
  return enforcePromptDecision(policyDecision, findings, {
    knownHits,
    fileHits,
    passUnmasked,
    proxyOn,
  });
}
// Signs the prompt's receipt; signed again, from the same findings, when the
// vault can't be saved (sentAsTypedDecision below).
const signPrompt = async (enforce, findingsOverride = null) => {
  const signed = await applyDisclosurePolicy({
    text: userPrompt,
    session,
    cwd,
    enforce,
    findingsOverride,
    // The ledger and the receipt keep only masked text; values the engine left
    // in place are tokenized through the vault first.
    sanitizeResidual: vault
      ? (text) => scrub(text, { vault, known, profile: 'secrets' }).text
      : null,
    publicClaimExtras: {
      unmask_receipt_extension: REVEAL_EXTENSION_MARKER,
      ...(receiptWarnings.length ? { entropy_warnings: receiptWarnings } : {}),
    },
    selectiveClaimExtras: receiptWarnings.length
      ? { entropy_warnings: receiptWarnings }
      : {},
  });
  try {
    initializeRevealReceiptExtension(signed.receipt);
  } catch (error) {
    // A read-only ZEROH_HOME has no key to sign the receipt's unmask
    // extension; the receipt then says so when verified. The prompt goes on.
    if (!notWritable(error)) throw error;
  }
  return signed;
};
result = await signPrompt(enforcedDecision);

let vaultPassNotice = null;
// A pass recorded after the turn's ledger is written, so writeTurn can't
// drop it (Astra pre-1.0.0 R5).
let pendingPass = null;
const mentionsFile = /(?:^|\s)@(?:[\w.~/-]|\\ )+/u.test(userPrompt);
if (
  !vault &&
  !passUnmasked &&
  ((result.replacements ?? []).length ||
    knownHits.length ||
    tokens.length ||
    mentionsFile)
) {
  // Owner decision (2026-09-27): through the proxy the prompt is sent with a
  // notice by default. Without the proxy it stays stopped (nothing else would
  // mask it); block mode stops it either way.
  if (proxyOn && (await passesUncertain())) {
    // The proxy sends it unmasked: tokens it can't restore would break the
    // user's work (packages/local-proxy/proxy.js).
    pendingPass = 'vault-unavailable';
  } else {
    const problem = vaultProblem(vaultFailure);
    // deny-inventory: vault-unavailable-prompt
    stopPrompt(
      `🛡 ZeroH stopped this prompt: masking is paused because ZeroH can't open its vault (${problem.reason}).\n${problem.fix}`,
    );
  }
}
promptTokens = new Map();
if (vault) {
  for (const r of result.replacements ?? []) {
    const token = vault.register(
      r.replacement,
      r.entity_type,
      userPrompt.slice(r.start, r.end),
      'prompt',
    );
    promptTokens.set(token, {
      token,
      type: r.entity_type,
      count: (promptTokens.get(token)?.count ?? 0) + 1,
    });
  }
  for (const hit of knownHits) {
    const token = vault.tokenFor(
      hit.type,
      hit.value,
      hit.vaultSource ?? `known:${hit.name}`,
    );
    if (!promptTokens.has(token)) {
      promptTokens.set(token, { token, type: hit.type, count: 1 });
    }
  }
}
// Fail closed: a hook that crashes lets the prompt through unmasked, so a
// save failure blocks any prompt that needed masking or restoring.
const needsVault =
  (result.replacements ?? []).length ||
  knownHits.length ||
  tokens.length ||
  fileHits.length;
if (vault) {
  try {
    vault.save();
  } catch (error) {
    if (needsVault && passUnmasked) {
      // Sent unmasked anyway (A1): nothing in the vault is needed.
    } else if (needsVault && proxyOn && (await passesUncertain())) {
      // Rule 8: the proxy masks only the values already on disk
      // (packages/zeroh-disclosure-core/restorable.js); what this prompt adds goes unmasked.
      pendingPass = UNSAVEABLE_REASON;
    } else if (needsVault) {
      // deny-inventory: vault-unsaveable-prompt
      stopPrompt(
        notWritable(error)
          ? `🛡 ZeroH stopped this prompt: it holds a value that must be masked, and ZeroH can't save its vault because its folder is read-only (${error.code}). Remove the value and send it again.`
          : '🛡 ZeroH stopped this prompt: it could not save its vault. Try again; if it keeps happening, run `/zeroh-disclosure:doctor`.',
      );
    }
  }
}

// Through the ZeroH proxy every request is masked before it leaves, so the
// prompt goes ahead; the receipt still records what was found.
if (proxyOn) {
  markPromptCleared();
  // The vault couldn't be saved: the proxy masked only the values already
  // on disk, and the others went to the model as typed. The receipt, the
  // ledger and the turn summary say so (Astra pre-1.0.0 R5): the receipt is
  // signed again as sent unmasked, the values not on disk are counted as
  // sent, and only the tokens the model saw are recorded.
  const unsaved = pendingPass === UNSAVEABLE_REASON ? unsavedValues() : null;
  if (unsaved?.sent.count)
    result = await signPrompt(sentAsTypedDecision, result.findings);
  const ledger = ledgerFromDisclosureResult({
    turn,
    phase: unsaved?.sent.count
      ? 'sent_unmasked_vault_unsaveable'
      : result.findings.length || knownHits.length
        ? 'masked_by_proxy'
        : 'allowed_no_findings',
    result,
    referencedTokens: tokens,
  });
  if (unsaved?.sent.count)
    ledger.audit = { ...(ledger.audit ?? {}), sent_unmasked: unsaved.sent };
  await writeTurn({ dir: session.dir, turn, payload: ledger });
  if (pendingPass) vaultPassNotice = await passUnchecked(pendingPass);
  if (unsaved?.sent.count) {
    // What the proxy did mask counts as masked; a token for a value that
    // went as typed was never seen.
    await recordPromptTokens(unsaved.masked, { countMasked: true });
  } else await recordPromptTokens([...promptTokens.values()]);
  await markDisclosureResultCommitted({ session, result });
  emitPromptNotice({
    additionalContext: entropyWarnings.length
      ? entropyWarningLine(entropyWarnings[0])
      : null,
    systemMessage:
      [vaultPassNotice, grantStatus].filter(Boolean).join('\n') || null,
  });
  process.exit(0);
}

const holdsFindings =
  result.findings.length > 0 || knownHits.length > 0 || fileHits.length > 0;
if (holdsFindings && passUnmasked) {
  // Sent as typed: recorded and told, never stopped.
  markPromptCleared();
  // Real values that reached the model in plain text, each counted once
  // however many detectors, known values or @-files found it (docs/receipt-
  // format.md "values sent": the status line, the Stop line, the receipt
  // slip and /report all count them this way).
  const sentUnmasked = distinctSentValues();
  const ledger = ledgerFromDisclosureResult({
    turn,
    phase: 'sent_unmasked_no_proxy',
    result,
    referencedTokens: tokens,
  });
  ledger.audit = { ...(ledger.audit ?? {}), sent_unmasked: sentUnmasked };
  await writeTurn({ dir: session.dir, turn, payload: ledger });
  await markDisclosureResultCommitted({ session, result });
  const noticeContext = await unmaskedPromptNoticeContext({ stopReason, cwd });
  const { notice } = await recordUnchecked({
    reason: noticeContext.reason,
    tool: 'prompt',
    cwd,
    sessionId,
    subject: 'prompt',
    why: noticeContext.why,
    valueNames: collectSentValueNames({
      result,
      userPrompt,
      knownHits,
      fileHits,
    }),
  });
  emitPromptNotice({
    systemMessage: [
      grantStatus,
      notice ? `${notice} ${noticeContext.suffix}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  process.exit(0);
}

if (holdsFindings) {
  await writeTurn({
    dir: session.dir,
    turn,
    payload: ledgerFromDisclosureResult({
      turn,
      phase: 'blocked_pending_user_resubmit',
      result,
      referencedTokens: tokens,
    }),
  });
  await markDisclosureResultCommitted({ session, result });
  const masked = scrub(result.sanitized_text || userPrompt, {
    vault,
    known,
    profile: 'secrets',
  }).text;
  try {
    vault.save();
  } catch {
    // The prompt is blocked either way; without a saved vault the suggested
    // rewrite's tokens could not be restored, so it is not offered.
    // deny-inventory: vault-unsaveable-prompt
    stopPrompt(
      '🛡 ZeroH stopped this prompt: it contains sensitive values, and ZeroH could not save its vault. Remove the values and send it again.',
    );
  }
  await emitBlock({ result, masked, knownHits, fileHits });
}

// Fully checked and clean: from here on a failed write must not stop it.
markPromptCleared();
await writeTurn({
  dir: session.dir,
  turn,
  payload: ledgerFromDisclosureResult({
    turn,
    phase:
      tokens.length > 0 ? 'allowed_tokenized_resubmit' : 'allowed_no_findings',
    result,
    referencedTokens: tokens,
  }),
});
if (tokens.length > 0 && vault) {
  await recordPromptTokens(
    tokens.flatMap((token) => {
      const entry = vault.entryOf(token);
      return entry ? [{ token, type: entry.type, count: 1 }] : [];
    }),
  );
}
await markDisclosureResultCommitted({ session, result });

if (tokens.length === 0) {
  // Pure clean prompt: receipt still issued at Stop, but no model-facing
  // signal needed.
  if (entropyWarnings.length) emitEntropyWarning(entropyWarnings[0]);
  else if (grantStatus) emitPromptNotice({ systemMessage: grantStatus });
  process.exit(0);
}

// Tokenized re-submit: clean by detection, but references prior tokens.
// Inject a token map so the model can reason about the placeholders.
const map = await collectActiveTokens(session.dir);
const relevant = tokens.filter((t) => map.has(t)).map((t) => [t, map.get(t)]);
if (relevant.length === 0) {
  emitPromptNotice({ systemMessage: grantStatus });
  process.exit(0);
}

const ctxLines = [
  '🛡  ZeroH Disclosure: this prompt references tokenized values from earlier in the session.',
  '',
  'Token map (the model never sees the raw values; treat tokens as opaque',
  'placeholders that the user can resolve locally):',
];
if (entropyWarnings.length)
  ctxLines.push('', entropyWarningLine(entropyWarnings[0]));
for (const [token, type] of relevant)
  ctxLines.push(`  ${token} = ${type.toLowerCase()}`);
if (await firstNoticeThisTurn({ cwd, sessionId, kind: NAMING_REMINDER }))
  ctxLines.push('', namingReminder(relevant[0][0]));

emit({
  ...(grantStatus ? { systemMessage: grantStatus } : {}),
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: [ctxLines.join('\n'), grantEndedContext]
      .filter(Boolean)
      .join('\n\n'),
  },
});
process.exit(0);
