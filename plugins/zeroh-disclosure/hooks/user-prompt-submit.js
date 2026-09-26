#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// UserPromptSubmit: check what the user typed. Through the proxy the prompt is
// masked on its way out; without it, a prompt holding a secret is stopped and
// a masked copy goes to the clipboard.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config.js';
import { Vault, vaultProblem } from '../lib/vault.js';
import { exactValueHits, loadKnownSecrets, scrub } from '../lib/secrets.js';
import {
  emit,
  markPromptCleared,
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
import { checkSessionProxy, routeSession } from '../lib/proxy-manager.js';
import { stopMessage } from '../lib/stop-message.js';

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
if (Buffer.byteLength(userPrompt) > MAX_CHECKED_PROMPT_BYTES) {
  stopPrompt(
    `🛡 ZeroH stopped this prompt: it is larger than ${MAX_CHECKED_PROMPT_BYTES / 1024} KB and could not be checked in time. Put the text in a file and ask Claude to read it: what it reads is masked.`,
  );
}
// One project root for sessions, vault and configuration (see projectDir).
const cwd = projectDir(event);
await loadConfig({ cwd });
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
    if (guard.block) stopPrompt(guard.message);
    // Restarted within the budget (RB-1: a SIGTERM mid-session): ask the
    // daemon again, so this prompt is masked rather than stopped. The route
    // is registered again first (the restarted daemon reads it from disk).
    refreshRoute(event);
    proxyOn = await proxyActive({ sessionId });
    if (!proxyOn) stopReason = 'unreachable';
  } else if (routing.state === 'not-written') {
    stopReason = 'not-set-up';
    routingNotice =
      "ZeroH Disclosure couldn't put this session behind its local proxy, so what you type can't be masked; typed secrets are stopped instead. `/zeroh-disclosure:doctor` shows why.";
  } else if (routing.state === 'not-applied') {
    stopReason = 'not-applied';
    routingNotice =
      "ZeroH Disclosure: Claude Code didn't switch this session to the local proxy, so what you type can't be masked here; typed secrets are stopped instead. A new Claude Code session uses it.";
  } else if (routing.state === 'no-login-item') {
    stopReason = 'no-login-item';
  } else if (routing.state === 'overridden') {
    stopReason = 'overridden';
  } else if (routing.state === 'not-configured') {
    const state = await proxyState({ sessionId });
    stopReason = state === 'provider' ? 'provider' : 'off';
  }
}
// A session counts as masked by the proxy when its traffic is known to reach
// it (LP-B5, T-29, lib/hook-io.js proxyConfirmed): the daemon has seen a
// request under this session id, or this hook's own environment names this
// install's proxy URL (the daemon, proven healthy above, masks this session
// and every request it cannot attribute while a ZeroH session is live). Only
// a session switched to the proxy mid-prompt waits for "seen": its secret is
// stopped as without the proxy (a clean prompt goes), and from its next
// prompt on its environment names the proxy.
const proxyUnconfirmed = proxyOn && !proxyConfirmed({ sessionId });
if (proxyUnconfirmed) {
  proxyOn = false;
  stopReason = 'not-ready';
}
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
const result = await applyDisclosurePolicy({
  text: userPrompt,
  session,
  cwd,
  enforce: enforcedDecision,
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
  initializeRevealReceiptExtension(result.receipt);
} catch (error) {
  // A read-only ZEROH_HOME has no key to sign the receipt's unmask
  // extension; the receipt then says so when verified. The prompt goes on.
  if (!notWritable(error)) throw error;
}

const mentionsFile = /(?:^|\s)@(?:[\w.~/-]|\\ )+/u.test(userPrompt);
if (
  !vault &&
  ((result.replacements ?? []).length ||
    knownHits.length ||
    tokens.length ||
    mentionsFile)
) {
  const problem = vaultProblem(vaultFailure);
  stopPrompt(
    `🛡 ZeroH stopped this prompt: masking is paused because ZeroH can't open its vault (${problem.reason}).\n${problem.fix}`,
  );
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
    if (needsVault) {
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
  await writeTurn({
    dir: session.dir,
    turn,
    payload: ledgerFromDisclosureResult({
      turn,
      phase:
        result.findings.length || knownHits.length
          ? 'masked_by_proxy'
          : 'allowed_no_findings',
      result,
      referencedTokens: tokens,
    }),
  });
  await recordPromptTokens([...promptTokens.values()]);
  await markDisclosureResultCommitted({ session, result });
  emitPromptNotice({
    additionalContext: entropyWarnings.length
      ? entropyWarningLine(entropyWarnings[0])
      : null,
    systemMessage: grantStatus,
  });
  process.exit(0);
}

if (result.findings.length > 0 || knownHits.length > 0 || fileHits.length > 0) {
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
  const lines = [];
  // An unreadable vault is told once per session, in plain words (LV-B2).
  if (vaultFailure && !state.vaultNoticeShown) {
    const problem = vaultProblem(vaultFailure);
    lines.push(
      `⚠ ZeroH Disclosure can't open its vault for this project: ${problem.reason}. Tool output is withheld and tool calls are stopped until that is fixed. ${problem.fix}`,
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
        hits.push({ path: rel, count: replacements.length });
    } catch {
      /* unreadable: nothing to report */
    }
  }
  return hits;
}

// helpers ---------------------------------------------------------------------

async function recordPromptTokens(entries) {
  if (!entries.length) return;
  await recordMaskedOutput({
    cwd: root,
    sessionId,
    channel: 'typed prompt',
    replacements: [],
    countMasked: false,
    observations: entries.map((entry) => ({
      ...entry,
      channel: 'typed prompt',
      source: 'typed prompt',
    })),
  });
}
