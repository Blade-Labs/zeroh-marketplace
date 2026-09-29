// SPDX-License-Identifier: AGPL-3.0-only

// Content ZeroH let through without protecting it. The default `uncertain`
// mode is `pass` (owner rule, 2026-09-27: ZeroH adds masking where there was
// none, and must not block Claude Code): what cannot be checked goes on as it
// is, and
//   - the user is told plainly, once per reason per turn, in one line shown
//     on screen (a systemMessage, never an instruction to the model):
//     `ZeroH Disclosure: this command was not protected (dynamic
//     destination); STRIPE_KEY was used without a destination check.`
//     The first such line of a session adds how to tighten
//     (UNCHECKED_HINTS).
//   - the pass is counted on the current turn, by reason and tool name, for
//     the Stop line ("N operations not protected"), the receipt,
//     /zeroh-disclosure:report and the status line.
// In `block` mode the same line, worded as a stop, is the denial reason.
// Nothing here ever holds a value, a command, a path or a host.
import { closeSync, existsSync, openSync } from 'node:fs';
import path from 'node:path';
import { readJson, sessionDir, writeJson } from './session.js';
import { acquireFileLock, releaseFileLock } from './vault.js';
import { addUnchecked, updateSessionStatus } from './session-status.js';

export const UNCHECKED_REASONS = Object.freeze([
  'dynamic-destination',
  'script-or-interpreter',
  'unknown-launcher',
  'unparseable',
  'watchdog-timeout',
  'unknown-format',
  'proxy-not-running',
  'raw-secret-in-command',
  'variable-in-command',
  'sensitive-file-masked',
  'too-large',
  'vault-unavailable',
  'vault-unsaveable',
  'config-unreadable',
  'check-failed',
  'token-vault-unavailable',
  'token-expired',
  'token-monitor',
  'token-late-binding',
]);

// Passes where the call ran with the token text instead of the real value:
// nothing reached the model, the command just did not get the key. Their
// notice says so ("ran with the token, not your key: …"), and they are not
// counted as "not protected".
export const TOKEN_REASONS = new Set([
  'token-vault-unavailable',
  'token-expired',
  'token-monitor',
  'token-late-binding',
]);

export const PROTECTED_REASONS = new Set(TOKEN_REASONS);

// The reason as the user reads it in the notice.
export const UNCHECKED_TEXT = Object.freeze({
  'dynamic-destination': 'dynamic destination',
  'script-or-interpreter': 'script or interpreter',
  'unknown-launcher': 'unknown launcher',
  unparseable: "couldn't parse it",
  'watchdog-timeout': 'timed out',
  'unknown-format': 'unknown format',
  'proxy-not-running': 'proxy not running',
  'raw-secret-in-command': 'a known secret written into the command',
  'variable-in-command': 'a variable whose value ZeroH cannot see',
  'sensitive-file-masked': 'private key or credential file read (masked)',
  'too-large': 'too large to scan',
  'vault-unavailable': "ZeroH couldn't open its vault",
  'vault-unsaveable': "ZeroH couldn't save its vault",
  'config-unreadable': "couldn't read .zeroh.env; using defaults",
  'check-failed': 'check failed',
  'token-vault-unavailable':
    "ZeroH couldn't open its vault. /zeroh-disclosure:doctor",
  'token-expired': 'the value expired (read the file again)',
  'token-monitor': "Monitor can't receive restored values",
  'token-late-binding': "ZeroH couldn't prepare the value",
});

// Short, value-free labels for the receipt and the report (each fits the
// 44-column slip).
export const UNCHECKED_LABELS = Object.freeze({
  'dynamic-destination': 'destination set at run time',
  'script-or-interpreter': 'value given to a script',
  'unknown-launcher': 'command via an unknown launcher',
  unparseable: 'command ZeroH could not parse',
  'watchdog-timeout': 'check took too long',
  'unknown-format': 'unreadable format (image, scan)',
  'proxy-not-running': 'local proxy not running',
  'raw-secret-in-command': 'a known secret written into the command',
  'variable-in-command': 'a variable sent, value unseen',
  'sensitive-file-masked': 'private key or credential file read (masked)',
  'too-large': 'prompt too large to scan',
  'vault-unavailable': 'vault could not be opened',
  'vault-unsaveable': 'vault could not be saved, new values sent',
  'config-unreadable': '.zeroh.env unreadable, defaults used',
  'check-failed': 'output check failed, passed as is',
  'token-vault-unavailable': 'ran with the token: vault unavailable',
  'token-expired': 'ran with the token: value expired',
  'token-monitor': 'ran with the token: Monitor',
  'token-late-binding': 'ran with the token: value not prepared',
});

// What a value named in the notice went without.
const CHECK_TEXT = Object.freeze({
  'dynamic-destination': 'a destination check',
  'script-or-interpreter': 'a destination check',
  'unknown-launcher': 'a destination check',
  unparseable: 'a destination check',
  'watchdog-timeout': 'a check',
  'unknown-format': 'a check',
  'proxy-not-running': 'masking',
  'raw-secret-in-command': 'masking',
  'variable-in-command': 'a destination check',
  'sensitive-file-masked': 'a check beyond masking',
  'too-large': 'a check',
  'vault-unavailable': 'masking',
  'vault-unsaveable': 'masking',
  'config-unreadable': 'its project settings',
  'check-failed': 'masking',
});

// A fix named on the line itself, in place of its full stop.
const FIX_SUFFIX = Object.freeze({
  'vault-unavailable': ' · /zeroh-disclosure:doctor',
  'vault-unsaveable': ' · /zeroh-disclosure:doctor',
});

// How to tighten, shown with a notice at most once per session (per kind).
// A raw secret in a command means ZeroH missed it earlier (the model could
// only write it after seeing it), so that hint is to report the miss and
// rotate the key; every other reason can be blocked instead.
export const UNCHECKED_HINTS = Object.freeze({
  uncertain:
    'To block these instead, run /zeroh-disclosure:settings uncertain block.',
  'report-miss':
    'ZeroH missed this value earlier: run /zeroh-disclosure:report-miss so it is masked from now on, and rotate the key.',
});

export function hintKind(reason) {
  return reason === 'raw-secret-in-command' ? 'report-miss' : 'uncertain';
}

const SUBJECTS = Object.freeze({
  command: 'this command',
  'tool call': 'this tool call',
  'tool output': 'this tool output',
  prompt: 'this prompt',
  // A request the local proxy sent to the model (it can't show a line
  // itself; the turn's Stop does, see deferNotice).
  'model request': 'a request to Claude',
});

// A value's name or type for the notice (`STRIPE_KEY`, `API_KEY`), or null:
// only an upper-case identifier, never anything that could be a value.
function valueNameLabel(name) {
  const value = String(name ?? '');
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(value) && !/\d{6,}/u.test(value)
    ? value
    : null;
}

// The one-line notice for `reason`. subject: 'command' (default), 'tool
// call', 'tool output' or 'prompt'. valueName: the name or type of a value
// involved (never the value). mode 'block' words it as a stop, for a denial
// reason. hint: add the reason's tightening sentence (UNCHECKED_HINTS).
export function uncheckedNotice(
  reason,
  { subject = 'command', valueName = null, mode = 'pass', hint = false } = {},
) {
  const text = UNCHECKED_TEXT[reason] ?? 'unknown reason';
  const what = SUBJECTS[subject] ?? SUBJECTS.command;
  const name = valueNameLabel(valueName);
  const line = TOKEN_REASONS.has(reason)
    ? mode === 'block'
      ? `ZeroH Disclosure: ${what} was stopped: it would run with the token, not your key (${text}).`
      : `ZeroH Disclosure: ${what} ran with the token, not your key: ${text}`
    : mode === 'block'
      ? `ZeroH Disclosure: ${what} was stopped because it could not be protected (${text})${name ? `; it used ${name}` : ''}.`
      : `ZeroH Disclosure: ${what} was not protected (${text})${name ? `; ${name} was used without ${CHECK_TEXT[reason] ?? 'a check'}` : ''}${FIX_SUFFIX[reason] ?? '.'}`;
  // In block mode only the missed-secret hint still applies.
  const kind = hintKind(reason);
  const separator =
    (PROTECTED_REASONS.has(reason) || FIX_SUFFIX[reason]) && mode !== 'block'
      ? '. '
      : ' ';
  return hint && (mode !== 'block' || kind === 'report-miss')
    ? `${line}${separator}${UNCHECKED_HINTS[kind]}`
    : line;
}

// Whether this session has not shown hint `kind` yet, claiming it if so: a
// marker file in the session folder, created exclusively so that parallel
// hooks show it once. Without a session folder to mark, the hint is shown.
export function claimSessionHint(dir, kind) {
  try {
    if (!existsSync(dir)) return true;
    closeSync(openSync(path.join(dir, `unchecked-hint-${kind}`), 'wx', 0o600));
    return true;
  } catch (error) {
    return error?.code !== 'EEXIST';
  }
}

// A tool name as a label: Claude Code's tool names and mcp__server__tool, at
// most 80 characters of [A-Za-z0-9_.:-]. Anything else is recorded as `other`,
// so no free text reaches the ledger through this field.
function toolLabel(tool) {
  const value = String(tool ?? '');
  return /^[A-Za-z0-9_.:-]{1,80}$/u.test(value) ? value : 'other';
}

// Records `count` (default 1) unprotected passes in
// audit.unchecked[reason][tool] of the session's current turn and returns
// { recorded, notice }: `notice` is the line to show (uncheckedNotice), or
// null when this reason was already shown this turn (audit.unchecked_noticed).
// The first notice of the session carries the hint (claimSessionHint); a
// missed raw secret has its own hint, also once per session.
// Without a turn to record on, nothing is recorded and the notice is still
// returned; an unknown reason gives { recorded: false, notice: null }.
// deferNotice: the caller can't show a line (the local proxy): the pass is
// recorded, and the reason, unless already shown this turn, is kept in
// audit.unchecked_deferred for the turn's Stop to show (takeDeferredNotices);
// the notice returned is null. Never
// throws, and waits at most `waitMs` for the turn's lock (the hook watchdog
// calls it with little time left). The hook-side call is one line:
//   const { notice } = await recordUnchecked({ reason, tool, cwd, sessionId,
//     subject, valueName });
export async function recordUnchecked({
  reason,
  tool,
  cwd,
  sessionId,
  subject = 'command',
  valueName = null,
  env = process.env,
  waitMs = 500,
  count = 1,
  deferNotice = false,
} = {}) {
  if (!UNCHECKED_REASONS.includes(reason)) {
    return { recorded: false, notice: null };
  }
  let dir = null;
  let hinted = null;
  // The hint is claimed only when the notice is actually shown.
  const noticeNow = () => {
    hinted ??= dir ? claimSessionHint(dir, hintKind(reason)) : true;
    return uncheckedNotice(reason, { subject, valueName, hint: hinted });
  };
  let lock = null;
  try {
    const add = Number.isInteger(count) && count > 0 ? count : 1;
    dir = sessionDir(path.resolve(cwd || process.cwd()), sessionId, env);
    const state = await readJson(path.join(dir, 'state.json'));
    const turn = Number(state?.turnCount ?? 0);
    if (!Number.isInteger(turn) || turn < 1) {
      return { recorded: false, notice: deferNotice ? null : noticeNow() };
    }
    const file = path.join(dir, `turn-${turn}.json`);
    lock = acquireFileLock(`${file}.lock`, { waitMs });
    const ledger = await readJson(file);
    if (!ledger || typeof ledger !== 'object') {
      return { recorded: false, notice: deferNotice ? null : noticeNow() };
    }
    const audit = (ledger.audit ??= {});
    const unchecked = (audit.unchecked ??= {});
    const byTool = (unchecked[reason] ??= {});
    const label = toolLabel(tool);
    byTool[label] = (Number(byTool[label]) || 0) + add;
    if (!Array.isArray(audit.unchecked_noticed)) audit.unchecked_noticed = [];
    const shown = audit.unchecked_noticed.includes(reason);
    if (deferNotice) {
      if (!Array.isArray(audit.unchecked_deferred))
        audit.unchecked_deferred = [];
      if (
        !shown &&
        !audit.unchecked_deferred.some((item) => item?.reason === reason)
      ) {
        audit.unchecked_deferred.push({
          reason,
          subject: Object.hasOwn(SUBJECTS, subject) ? subject : 'command',
        });
      }
    } else if (!shown) audit.unchecked_noticed.push(reason);
    await writeJson(file, ledger);
    // The status line's "N not protected" for this turn.
    if (!PROTECTED_REASONS.has(reason)) {
      updateSessionStatus(
        {
          cwd: path.resolve(cwd || process.cwd()),
          sessionId,
          env,
          waitMs: 100,
        },
        (status) => addUnchecked(status, turn, add),
      );
    }
    return {
      recorded: true,
      notice: shown || deferNotice ? null : noticeNow(),
    };
  } catch {
    // Recording is best effort: the content has already been passed, and
    // the user is still told.
    return { recorded: false, notice: deferNotice ? null : noticeNow() };
  } finally {
    if (lock) {
      try {
        releaseFileLock(lock);
      } catch {
        // A lock left behind is reclaimed when it goes stale.
      }
    }
  }
}

// Totals per reason from one turn's audit.unchecked (or several merged).
export function uncheckedCounts(...audits) {
  const counts = {};
  for (const audit of audits) {
    const unchecked = audit?.unchecked;
    if (!unchecked || typeof unchecked !== 'object') continue;
    for (const reason of UNCHECKED_REASONS) {
      const byTool = unchecked[reason];
      if (!byTool || typeof byTool !== 'object') continue;
      for (const count of Object.values(byTool)) {
        const n = Number(count);
        if (Number.isFinite(n) && n > 0)
          counts[reason] = (counts[reason] || 0) + n;
      }
    }
  }
  return counts;
}

// The lines a caller that can't show one (the local proxy) left for this
// turn (recordUnchecked, deferNotice), each reason at most once per turn:
// they move to audit.unchecked_noticed and are returned for the Stop hook to
// show. Never throws; [] when there is nothing to show.
export async function takeDeferredNotices({
  cwd,
  sessionId,
  env = process.env,
  waitMs = 500,
} = {}) {
  let lock = null;
  try {
    const dir = sessionDir(path.resolve(cwd || process.cwd()), sessionId, env);
    const state = await readJson(path.join(dir, 'state.json'));
    const turn = Number(state?.turnCount ?? 0);
    if (!Number.isInteger(turn) || turn < 1) return [];
    const file = path.join(dir, `turn-${turn}.json`);
    lock = acquireFileLock(`${file}.lock`, { waitMs });
    const ledger = await readJson(file);
    const audit = ledger?.audit;
    const deferred = Array.isArray(audit?.unchecked_deferred)
      ? audit.unchecked_deferred
      : [];
    if (!deferred.length) return [];
    if (!Array.isArray(audit.unchecked_noticed)) audit.unchecked_noticed = [];
    const lines = [];
    for (const item of deferred) {
      const reason = item?.reason;
      if (
        !UNCHECKED_REASONS.includes(reason) ||
        audit.unchecked_noticed.includes(reason)
      )
        continue;
      audit.unchecked_noticed.push(reason);
      lines.push(
        uncheckedNotice(reason, {
          subject: item.subject,
          hint: claimSessionHint(dir, hintKind(reason)),
        }),
      );
    }
    delete audit.unchecked_deferred;
    await writeJson(file, ledger);
    return lines;
  } catch {
    return [];
  } finally {
    if (lock) {
      try {
        releaseFileLock(lock);
      } catch {
        // A lock left behind is reclaimed when it goes stale.
      }
    }
  }
}
