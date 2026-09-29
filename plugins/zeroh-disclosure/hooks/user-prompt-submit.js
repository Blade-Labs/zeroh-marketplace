#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// UserPromptSubmit: check what the user typed. Through the proxy the prompt is
// masked on its way out; without it, a prompt holding a secret is sent as
// typed with a notice (rc.2 default), or, in `uncertain block` mode, stopped
// with a masked copy on the clipboard.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, uncertainMode } from '../lib/config.js';
import { recordUnchecked, uncheckedNotice } from '../lib/unchecked.js';
import { addSent, updateSessionStatus } from '../lib/session-status.js';
import { Vault, vaultProblem, zerohHome } from '../lib/vault.js';
import { applyFirstRunDefaults } from '../lib/first-run.js';
import { exactValueHits, loadKnownSecrets, scrub } from '../lib/secrets.js';
import {
  emit,
  markPromptCleared,
  markSideEffect,
  projectDir,
  proxyActive,
  proxyConfirmed,
  proxyState,
  readStdinJson,
  refreshRoute,
  stopPrompt,
} from '../lib/hook-io.js';
import { detectEntropyWarnings } from '../lib/detector.js';
import {
  bumpTurn,
  collectActiveTokens,
  extractTokens,
  loadSession,
  notWritable,
  writeTurn,
} from '../lib/session.js';
import { writeClipboard } from '../lib/clipboard.js';
import { firstNoticeThisTurn } from '../lib/format-audit.js';
import { NAMING_REMINDER, namingReminder } from '../lib/token-pattern.js';
import {
  applyDisclosurePolicy,
  ledgerFromDisclosureResult,
  markDisclosureResultCommitted,
} from '../lib/disclosure.js';
import {
  activeGrants,
  formatStatusline,
  initializeRevealReceiptExtension,
  REVEAL_EXTENSION_MARKER,
} from '../lib/unmask.js';
import { recordMaskedOutput } from '../lib/report.js';
import { persistedEntries, UNSAVEABLE_REASON } from '../lib/restorable.js';
import { checkSessionProxy, routeSession } from '../lib/proxy-manager.js';
import { stopMessage } from '../lib/stop-message.js';
import {
  handleManagementPrompt,
  isManagementPrompt,
} from '../lib/user-authority.js';

// A prompt larger than this is stopped rather than scanned, so the hook finishes
// well inside its timeout (Claude Code sends the prompt when a hook times out).
// A prompt dense with findings scans slower than linear: about 8 s for 500 KB
// on the reference machine, against the hook's 10 s timeout.
const MAX_CHECKED_PROMPT_BYTES = 256 * 1024;
// An active unmask is shown again when this little time remains.
const GRANT_REMINDER_MS = 5 * 60 * 1000;

// Fail closed (hooks/run.js): until the prompt is known to be safe to send,
// any error stops it (exit 2).
const event = await readStdinJson();
const userPrompt = event?.prompt ?? event?.user_prompt ?? '';
if (typeof userPrompt !== 'string' || userPrompt.length === 0) {
  process.exit(0);
}
// The `uncertain` mode (lib/config.js); `pass` unless configured to block.
async function passesUncertain() {
  try {
    await loadConfig({ cwd: projectDir(event) });
    return uncertainMode() === 'pass';
  } catch {
    return true;
  }
}

// Sends the prompt as it is, with the one-line "not protected" notice
// (product principles: pass what we can't check, and say so).
async function passUnchecked(reason, suffix = '') {
  let notice = null;
  try {
    ({ notice } = await recordUnchecked({
      reason,
      tool: 'UserPromptSubmit',
      cwd: projectDir(event),
      sessionId: event?.session_id,
      subject: 'prompt',
    }));
  } catch {
    // recordUnchecked never throws; the notice below still shows.
  }
  return `${notice ?? uncheckedNotice(reason, { subject: 'prompt' })}${suffix}`;
}

if (Buffer.byteLength(userPrompt) > MAX_CHECKED_PROMPT_BYTES) {
  // Owner decision (2026-09-27): sent unscanned by default; block mode stops it.
  if (await passesUncertain()) {
    markPromptCleared();
    emit({ systemMessage: await passUnchecked('too-large') });
    process.exit(0);
  }
  // deny-inventory: prompt-too-large
  stopPrompt(
    `🛡 ZeroH stopped this prompt: it is larger than ${MAX_CHECKED_PROMPT_BYTES / 1024} KB and could not be checked in time. Put the text in a file and ask Claude to read it: what it reads is masked.`,
  );
}
// A management slash command the user typed (proxy off/on, doctor --fix,
// uninstall --yes, allow, settings, unmask caps): its `!` block only recorded
// the request, and the user's own typed prompt is what applies it (Astra R3,
// lib/user-authority.js). The result is shown and the prompt stops here:
// there is nothing for the model to do. The session's next prompt goes on
// through the retired proxy (bin/proxy-daemon.mjs) after `proxy off`,
// `doctor --fix` or `uninstall`.
// Any failure here leaves an ordinary prompt alone; only ZeroH's own
// management command is then stopped, with nothing changed.
{
  let managed = null;
  try {
    managed = handleManagementPrompt({
      prompt: userPrompt,
      sessionId: event?.session_id,
      cwd: projectDir(event),
      markSideEffect,
    });
  } catch {
    if (isManagementPrompt(userPrompt))
      managed = {
        message:
          'Nothing changed: ZeroH could not check this request. Type the command again; if it keeps happening, run /zeroh-disclosure:doctor.',
      };
  }
  // deny-inventory: management-request
  if (managed) stopPrompt(managed.message);
}
// One project root for sessions, vault and configuration (see projectDir).
const cwd = projectDir(event);
await loadConfig({ cwd });
// What happens to a typed secret the proxy can't mask (the `uncertain` mode).
const TYPED_SECRETS =
  uncertainMode() === 'block'
    ? 'typed secrets are stopped instead'
    : 'a typed secret is sent with a "not protected" line';
const sessionId = event?.session_id;
const root = projectDir(event);
refreshRoute(event);
// Whether the proxy masks this session's request, asked of the daemon itself.
let proxyOn = await proxyActive({ sessionId });
let routingNotice = null;
// Why a prompt holding a secret cannot be sent for masking (lib/stop-message.js).
let stopReason = null;
// Put behind the proxy by this very prompt (T-19).
let switchedNow = false;
if (!proxyOn) {
  // A session that does not use the proxy yet (its first prompt after the
  // install, or after a reset): write the settings entry and wait until the
  // running Claude Code applies it, so this prompt already goes through it.
  const routing = await routeSession({ sessionId, root });
  proxyOn = routing.routed;
  switchedNow = routing.routed;
  if (routing.state === 'configured') {
    // Never let Claude Code retry against a proxy that is gone (D-10): when
    // this session's base URL is a ZeroH proxy that does not answer, restart
    // it within a short budget; failing that, stop the prompt.
    const guard = await checkSessionProxy({ sessionId, root });
    // deny-inventory: dead-proxy
    if (guard.block) stopPrompt(guard.message);
    // Restarted within the budget (RB-1: a SIGTERM mid-session): ask the
    // daemon again, so this prompt is masked rather than stopped. The route
    // is registered again first (the restarted daemon reads it from disk).
    refreshRoute(event);
    proxyOn = await proxyActive({ sessionId });
    // A retired proxy (`proxy off`, doctor --fix) still carries this
    // session, masking only what it masked before: as off for new values.
    if (!proxyOn)
      stopReason = guard.state === 'retired' ? 'off' : 'unreachable';
  } else if (routing.state === 'not-written') {
    stopReason = 'not-set-up';
    routingNotice = `ZeroH Disclosure couldn't put this session behind its local proxy, so what you type can't be masked; ${TYPED_SECRETS}. \`/zeroh-disclosure:doctor\` shows why.`;
  } else if (routing.state === 'not-applied') {
    stopReason = 'not-applied';
    routingNotice = `ZeroH Disclosure: Claude Code didn't switch this session to the local proxy, so what you type can't be masked here; ${TYPED_SECRETS}. A new Claude Code session uses it.`;
  } else if (routing.state === 'overridden') {
    stopReason = 'overridden';
  } else if (routing.state === 'not-configured') {
    const state = await proxyState({ sessionId });
    stopReason = state === 'provider' ? 'provider' : 'off';
  }
}
// A session counts as masked by the proxy when its traffic is known to reach
// it (T-29, lib/hook-io.js proxyConfirmed): the daemon has seen a request
// under this session id, or this hook's own environment names this install's
// proxy URL (the daemon, proven healthy above, masks this session's own
// requests; one it cannot attribute passes through unmasked). Only a session
// switched to the proxy mid-prompt waits for "seen": its secret is handled as
// without the proxy (sent with a notice; stopped with `uncertain block`), and
// from its next prompt on its environment names the proxy.
const proxyUnconfirmed = proxyOn && !proxyConfirmed({ sessionId });
if (proxyUnconfirmed) {
  proxyOn = false;
  stopReason = 'not-ready';
}
// Without the proxy nothing can mask the prompt. In the default `uncertain`
// mode (pass; owner rule 2026-09-27) a prompt holding a secret is sent as
// typed and the user is told in one line; `uncertain block` stops it as
// before (lib/stop-message.js).
const passUnmasked = !proxyOn && uncertainMode() === 'pass';
// What to do about a prompt sent unmasked, by why the proxy was not there.
const UNMASKED_FIX = {
  off: 'You turned the local proxy off; /zeroh-disclosure:proxy on turns it back on.',
  provider:
    'Claude Code talks to Bedrock, Vertex or Foundry directly, so there is no proxy to mask it.',
  'not-ready':
    'This session was just switched to the proxy; from your next prompt it is masked.',
  default: 'Fix it with /zeroh-disclosure:doctor.',
};
// Every prompt — clean, tokenized re-submit, or PII-bearing — gets a turn and
// a receipt. The receipt is the deliverable: it records that the policy was
// applied and what it observed, signed locally. Masking is one
// possible outcome; "policy applied, 0 findings" is just as valid a proof.

const session = await loadSession({ cwd, sessionId });
let vault = null;
let vaultFailure = null;
try {
  vault = new Vault(root, { sessionId: event?.session_id });
} catch (error) {
  // A clean prompt can proceed: PostToolUse will withhold any output it cannot
  // mask. Anything that already needs tokenization or restoration is blocked.
  vaultFailure = error;
}
// The notices shown above this prompt, each only when it is news (T-25): an
// unmask grant on the first prompt after it starts, again when 5 minutes or
// less remain, and once when it ends; the routing problem once.
const grantStatus = promptNotices(session.state);

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
const known = loadKnownSecrets(root);
const knownHits = known.filter((k) => userPrompt.includes(k.value));
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
const fileHits =
  proxyOn || !vault ? [] : mentionedFileSecrets(userPrompt, root);
// What this hook does with the prompt, recorded in the signed receipt: the
// proxy masks what it found and sends it; without the proxy any finding stops
// the prompt. A clean prompt keeps the policy's own decision.
function enforcedDecision(policyDecision, findings) {
  const extra = knownHits.map((hit) => hit.type);
  if (!findings.length && !extra.length && !fileHits.length)
    return policyDecision;
  const categories = [...new Set([...findings.map((f) => f.type), ...extra])];
  if (passUnmasked)
    return {
      ...policyDecision,
      action: 'allow',
      enforced: 'sent_unmasked',
      policy_action: policyDecision.action,
      reason:
        'The local proxy was not in the route, so the prompt was sent as typed (uncertain cases: pass).',
      // Masked only in the ledger copy; what was sent was not masked.
      mask_categories: categories,
      extra_categories: extra,
      ...(fileHits.length
        ? { mentioned_files_with_findings: fileHits.length }
        : {}),
      blocked: false,
    };
  if (proxyOn)
    return {
      ...policyDecision,
      action: 'mask_and_allow',
      enforced: 'masked_by_proxy',
      policy_action: policyDecision.action,
      reason: 'The local proxy masked these values before the prompt was sent.',
      mask_categories: categories,
      extra_categories: extra,
      blocked: false,
    };
  return {
    ...policyDecision,
    action: 'block',
    enforced: 'stopped',
    policy_action: policyDecision.action,
    reason:
      'The prompt was stopped before sending; the user was offered a masked copy.',
    // Masked only in the copy offered to the user, which was not sent.
    mask_categories: categories,
    extra_categories: extra,
    ...(fileHits.length
      ? { mentioned_files_with_findings: fileHits.length }
      : {}),
    blocked: true,
  };
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
let result = await signPrompt(enforcedDecision);

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
    // user's work (lib/proxy.js).
    pendingPass = 'vault-unavailable';
  } else {
    const problem = vaultProblem(vaultFailure);
    // deny-inventory: vault-unavailable-prompt
    stopPrompt(
      `🛡 ZeroH stopped this prompt: masking is paused because ZeroH can't open its vault (${problem.reason}).\n${problem.fix}`,
    );
  }
}
const promptTokens = new Map();
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
      // (lib/restorable.js); what this prompt adds goes unmasked.
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
    updateSessionStatus({ cwd, sessionId }, (status) =>
      addSent(status, unsaved.sent.count),
    );
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
  updateSessionStatus({ cwd, sessionId }, (status) =>
    addSent(status, sentUnmasked.count),
  );
  const { notice } = await recordUnchecked({
    reason: 'proxy-not-running',
    tool: 'prompt',
    cwd,
    sessionId,
    subject: 'prompt',
    valueName:
      knownHits[0]?.name && /^[A-Z][A-Z0-9_]*$/u.test(knownHits[0].name)
        ? knownHits[0].name
        : (result.findings[0]?.type ?? knownHits[0]?.type ?? null),
  });
  emitPromptNotice({
    systemMessage: [
      grantStatus,
      notice
        ? `${notice} ${UNMASKED_FIX[stopReason] ?? UNMASKED_FIX.default}`
        : null,
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
    additionalContext: ctxLines.join('\n'),
  },
});
process.exit(0);

// block emitter ---------------------------------------------------------------

async function emitBlock({ result, masked, knownHits, fileHits }) {
  const rewrite = fileHits.length ? null : masked;
  const copied = rewrite
    ? Boolean(await writeClipboard(rewrite).catch(() => null))
    : false;
  // Kinds only: the values are named by provider (public prefix catalog) or
  // type, never shown. The receipt records the findings themselves.
  const values = [
    ...(result.replacements ?? []).map((r) => ({
      type: r.entity_type,
      value: userPrompt.slice(r.start, r.end),
    })),
    ...knownHits.map((hit) => ({ type: hit.type, value: hit.value })),
  ];
  // deny-inventory: typed-secret-no-proxy
  stopPrompt(
    stopMessage({
      values,
      files: fileHits,
      reason: stopReason ?? 'unreachable',
      masked: rewrite,
      copied,
      // True only for a session switched to the proxy with this prompt: from
      // the next one its environment names the proxy.
      nextMasked: stopReason === 'not-ready' && switchedNow,
    }),
    { systemMessage: grantStatus || null },
  );
}

function promptNotices(state) {
  // The first prompt ZeroH sees for these Claude Code settings turns on its
  // status line and auto-update, each with one line (lib/first-run.js). Like
  // the proxy entry, it is written now rather than at SessionStart: Claude
  // Code applies a settings change to the running session only once it
  // watches the file.
  const lines = [...applyFirstRunDefaults({ home: zerohHome() }).lines];
  // An unreadable vault is told once per session, in plain words (LV-B2).
  if (vaultFailure && !state.vaultNoticeShown) {
    const problem = vaultProblem(vaultFailure);
    lines.push(
      `⚠ ZeroH Disclosure can't open its vault for this project: ${problem.reason}. ${
        uncertainMode() === 'block'
          ? 'Tool output is withheld and tool calls are stopped until that is fixed.'
          : 'Until that is fixed nothing can be masked: tool output goes to Claude as it is, with a "not protected" line.'
      } ${problem.fix}`,
    );
    state.vaultNoticeShown = true;
  }
  if (routingNotice && !state.routingNoticeShown) {
    lines.push(routingNotice);
    state.routingNoticeShown = true;
  }
  const grants = activeGrants(root, { sessionId });
  const seen = { ...(state.grantNotices ?? {}) };
  const now = Date.now();
  for (const grant of grants) {
    const left =
      grant.expires_at == null ? Infinity : Date.parse(grant.expires_at) - now;
    if (!seen[grant.id] || left <= GRANT_REMINDER_MS) {
      lines.push(formatStatusline([grant], now));
    }
    seen[grant.id] = { kind: grant.kind };
  }
  for (const [id, { kind }] of Object.entries(seen)) {
    if (grants.some((grant) => grant.id === id)) continue;
    lines.push(`${kind} is masked again: the unmask ended.`);
    delete seen[id];
  }
  state.grantNotices = seen;
  return lines.join('\n');
}

function entropyWarningLine(warning) {
  return `ZeroH Disclosure: a random-looking value (${warning.length} characters) matches no rule; it was sent as is. /zeroh-disclosure:report-miss masks it from now on.`;
}

function emitEntropyWarning(warning) {
  emitPromptNotice({
    additionalContext: entropyWarningLine(warning),
    systemMessage: grantStatus,
  });
}

function emitPromptNotice({ additionalContext = null, systemMessage = null }) {
  if (!additionalContext && !systemMessage) return;
  emit({
    ...(systemMessage ? { systemMessage } : {}),
    ...(additionalContext
      ? {
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext,
          },
        }
      : {}),
  });
}

// The distinct values a prompt sent as typed puts in front of the model:
// detector findings, known values and values of @-mentioned files, keyed by
// the value itself so one key found by two detectors, or typed and also in
// .env, counts once. { count, by_type } for the turn record.
function distinctSentValues() {
  const byValue = new Map();
  const note = (value, type) => {
    if (typeof value !== 'string' || !value || byValue.has(value)) return;
    byValue.set(value, type || 'UNKNOWN');
  };
  for (const r of result.replacements ?? []) {
    if (Number.isInteger(r.start) && Number.isInteger(r.end)) {
      note(userPrompt.slice(r.start, r.end), r.entity_type);
    }
  }
  for (const f of result.findings ?? []) {
    if (Number.isInteger(f.start) && Number.isInteger(f.end)) {
      note(userPrompt.slice(f.start, f.end), f.type);
    }
  }
  for (const hit of knownHits) note(hit.value, hit.type);
  for (const hit of fileHits) {
    for (const entry of hit.values ?? []) note(entry.value, entry.type);
  }
  const by_type = {};
  for (const type of byValue.values()) by_type[type] = (by_type[type] ?? 0) + 1;
  return { count: byValue.size, by_type };
}

// After a failed vault save: { sent: { count, by_type } for the distinct
// values not on disk (the proxy sent them as typed), masked: the prompt's
// token entries whose value is on disk (the proxy masked them) }.
function unsavedValues() {
  const onDisk = new Set(persistedEntries(vault).map((entry) => entry.value));
  const sent = new Map();
  const note = (value, type) => {
    if (typeof value !== 'string' || !value || onDisk.has(value)) return;
    if (!sent.has(value)) sent.set(value, type || 'UNKNOWN');
  };
  for (const r of result.replacements ?? [])
    if (Number.isInteger(r.start) && Number.isInteger(r.end))
      note(userPrompt.slice(r.start, r.end), r.entity_type);
  for (const f of result.findings ?? [])
    if (Number.isInteger(f.start) && Number.isInteger(f.end))
      note(userPrompt.slice(f.start, f.end), f.type);
  for (const hit of knownHits) note(hit.value, hit.type);
  const by_type = {};
  for (const type of sent.values()) by_type[type] = (by_type[type] ?? 0) + 1;
  const masked = [...promptTokens.values()].filter((entry) =>
    onDisk.has(vault.valueOf(entry.token)),
  );
  return { sent: { count: sent.size, by_type }, masked };
}

// The signed decision for a prompt whose new values went as typed because
// the vault couldn't be saved (uncertain: pass; rule 8).
function sentAsTypedDecision(policyDecision, findings) {
  const extra = knownHits.map((hit) => hit.type);
  return {
    ...policyDecision,
    action: 'allow',
    enforced: 'sent_unmasked',
    policy_action: policyDecision.action,
    reason:
      "ZeroH couldn't save its vault, so the local proxy masked only the values already in it; the others were sent as typed (uncertain cases: pass).",
    mask_categories: [...new Set([...findings.map((f) => f.type), ...extra])],
    extra_categories: extra,
    blocked: false,
  };
}

// Files mentioned with @ that hold secrets or personal data.
function mentionedFileSecrets(prompt, dir) {
  const hits = [];
  for (const m of prompt.matchAll(/(?:^|\s)@((?:[\w.~/-]|\\ )+)/g)) {
    const rel = m[1].replace(/\\ /g, ' ');
    const abs = path.resolve(
      dir,
      rel.replace(/^~(?=\/)/, process.env.HOME || '~'),
    );
    try {
      if (
        !existsSync(abs) ||
        !statSync(abs).isFile() ||
        statSync(abs).size > 512 * 1024
      )
        continue;
      const { replacements } = scrub(readFileSync(abs, 'utf8'), {
        vault,
        known,
        profile: 'tool',
      });
      if (replacements.length)
        hits.push({
          path: rel,
          count: replacements.length,
          values: replacements
            .map((r) => ({
              value: vault.entryOf(r.token)?.value,
              type: r.type,
            }))
            .filter((entry) => typeof entry.value === 'string'),
        });
    } catch {
      /* unreadable: nothing to report */
    }
  }
  return hits;
}

// helpers ---------------------------------------------------------------------

async function recordPromptTokens(entries, { countMasked = false } = {}) {
  if (!entries.length) return;
  await recordMaskedOutput({
    cwd: root,
    sessionId,
    channel: 'typed prompt',
    replacements: countMasked ? entries : [],
    countMasked,
    observations: entries.map((entry) => ({
      ...entry,
      channel: 'typed prompt',
      source: 'typed prompt',
    })),
  });
}
