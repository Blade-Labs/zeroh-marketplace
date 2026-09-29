// SPDX-License-Identifier: AGPL-3.0-only

// What each hook answers when it fails, so a failure never lets content
// through: a prompt is stopped (exit 2), a tool call denied, tool output
// withheld in the tool's own shape. Node built-ins only and no imports, so
// the loader (run.js) can rely on it when the hook itself cannot load.

export const HOOKS = Object.freeze({
  'session-start': 'SessionStart',
  'user-prompt-submit': 'UserPromptSubmit',
  'pre-tool-use': 'PreToolUse',
  'post-tool-use': 'PostToolUse',
  'message-display': 'MessageDisplay',
  stop: 'Stop',
  'session-end': 'SessionEnd',
  // PostToolUseFailure and PermissionDenied: a shell command that did not
  // run (or stopped early) leaves no late-binding values file behind.
  'tool-not-run': 'PostToolUseFailure',
});

// Each hook's timeout in hooks.json, in seconds. The loader (run.js) answers
// fail-closed two seconds before it, so Claude Code never has to kill a hook:
// a killed hook's answer is lost and the event goes through unchecked.
export const HOOK_TIMEOUTS = Object.freeze({
  'session-start': 15,
  'user-prompt-submit': 10,
  'pre-tool-use': 10,
  'post-tool-use': 15,
  'message-display': 5,
  stop: 30,
  'session-end': 10,
  'tool-not-run': 5,
});

// What failing closed means for each hook: what the user is left with when
// the hook errors or runs out of time.
export const FAIL_CLOSED = Object.freeze({
  'session-start':
    'no banner or setup this time; the other hooks still mask and deny on their own',
  'user-prompt-submit': 'the prompt is stopped and nothing is sent',
  'pre-tool-use': 'the tool call is denied',
  'post-tool-use': 'the tool output is withheld',
  'message-display': 'tokens stay tokens on screen',
  stop: 'no receipt is signed for this turn',
  'session-end': 'the session is tidied up at the next start instead',
  'tool-not-run':
    "the command's restored values are removed at the end of the turn instead",
});

// The loader's deadline for hook `name`, in milliseconds: its timeout minus
// 2 s. ZEROH_HOOK_DEADLINE_MS can only shorten it (tests use it).
export function hookDeadlineMs(name, env = process.env) {
  const full = Math.max(1, (HOOK_TIMEOUTS[name] ?? 10) - 2) * 1000;
  const override = Number.parseInt(env.ZEROH_HOOK_DEADLINE_MS ?? '', 10);
  return Number.isFinite(override) && override > 0
    ? Math.min(full, override)
    : full;
}

export const ERROR_WITHHELD =
  'ZeroH Disclosure could not check this tool output, so it was withheld. Try again; if it keeps happening, run `/zeroh-disclosure:doctor`.';

export const MIN_NODE_MAJOR = 20;

// The answer on a Node.js older than 20 (LP-B6), or null. An older Node would
// fail on every event and stop every prompt, which blocks Claude Code;
// instead SessionStart says so once, plainly, and every other hook steps
// aside. (Without any `node` on PATH the hook command itself cannot start:
// Claude Code shows its own non-blocking hook error, and the README makes
// Node 20+ the first install step.)
export function oldNodeAnswer(name, version) {
  const major = Number.parseInt(String(version), 10);
  if (major >= MIN_NODE_MAJOR) return null;
  if (name !== 'session-start') return { stdout: '' };
  return {
    stdout: `${JSON.stringify({
      systemMessage: `⚠ ZeroH Disclosure needs Node.js ${MIN_NODE_MAJOR} or later, and this is Node.js ${version}, so it is not protecting this session: nothing is masked or stopped. Install Node.js ${MIN_NODE_MAJOR}+ (https://nodejs.org) and start a new Claude Code session.`,
    })}\n`,
  };
}

// The error the loader passes when a hook ran out of time.
export function timeoutError(ms) {
  return Object.assign(new Error('hook timed out'), {
    code: 'TIMEOUT',
    seconds: Math.round(ms / 100) / 10,
  });
}

// A short, value-free name for an error: its code or class, never its message.
export function errorLabel(error) {
  const code = error?.code ? `${error.code}` : error?.name || 'error';
  return /^[A-Za-z0-9_]{1,40}$/u.test(code) ? code : 'error';
}

// A Read response holding one line of text.
export function readTextOutput(filePath, content) {
  return {
    type: 'text',
    file: {
      filePath: filePath || '',
      content,
      numLines: 1,
      startLine: 1,
      totalLines: 1,
    },
  };
}

// Claude Code ignores an updatedToolOutput whose shape does not match the
// tool's response and passes the original through, so withheld output keeps
// the response's structure: a Read becomes a one-line text file, and anything
// else keeps its keys with every value string replaced by `message`.
export function withheldOutput(toolName, response, filePath, message) {
  if (toolName === 'Read' && response && typeof response === 'object') {
    return readTextOutput(filePath || response.file?.filePath || '', message);
  }
  const keep = new Set([
    'type',
    'filePath',
    'file_path',
    'path',
    'name',
    'id',
    'tool_use_id',
    'mimeType',
    'media_type',
  ]);
  const replace = (value, key) => {
    if (typeof value === 'string') return keep.has(key) ? value : message;
    if (Array.isArray(value)) return value.map((item) => replace(item, key));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, replace(v, k)]),
      );
    }
    return value;
  };
  return replace(response, '');
}

function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// What the notice calls the event: "this prompt", "this command" (a shell
// tool), "this tool call" or "this tool output". The loader asks lib/unchecked.js
// for the same subject ('prompt', 'command', 'tool call', 'tool output').
export function noticeSubject(name, raw) {
  if (name === 'user-prompt-submit') return 'prompt';
  if (name === 'post-tool-use') return 'tool output';
  if (name === 'pre-tool-use') {
    const tool = parse(raw)?.tool_name;
    return ['Bash', 'PowerShell', 'Monitor'].includes(tool)
      ? 'command'
      : 'tool call';
  }
  return 'event';
}

// The one-line notice when lib/unchecked.js cannot be used (the same words as
// its uncheckedNotice): `ZeroH Disclosure: this command was not protected
// (timed out).`
export function plainNotice(name, raw, why, mode = 'pass') {
  const what = `this ${noticeSubject(name, raw)}`;
  return mode === 'block'
    ? `ZeroH Disclosure: ${what} was stopped because it could not be protected (${why}).`
    : `ZeroH Disclosure: ${what} was not protected (${why}).`;
}

// The answer in the default `uncertain` mode, pass: the event goes on
// unprotected, as Claude Code does itself when a hook times out, and the
// user is told in one line on screen (a systemMessage, never an instruction
// to the model). For a timeout the loader passes lib/unchecked.js's `notice`,
// which is null once the reason was shown this turn: then nothing is said.
// The hooks that guard nothing (SessionStart, MessageDisplay, Stop,
// SessionEnd) answer as in block mode: a non-blocking error.
export function passAnswer(name, raw, state, error, { notice } = {}) {
  const label = errorLabel(error);
  const timedOut = error?.code === 'TIMEOUT';
  const halfDone = state.sideEffect
    ? ` ZeroH was ${state.sideEffect} when it ${timedOut ? 'ran out of time' : 'failed'}, so that may be half-done: run \`/zeroh-disclosure:doctor\` to check it.`
    : '';
  const guards = ['user-prompt-submit', 'pre-tool-use', 'post-tool-use'];
  if (!guards.includes(name)) return failClosedAnswer(name, raw, state, error);
  if (state.emitted) return { code: 0 };
  if (name === 'user-prompt-submit' && state.cleared) {
    return halfDone
      ? {
          code: 0,
          stdout: `${JSON.stringify({ systemMessage: `🛡${halfDone}` })}\n`,
        }
      : { code: 0 };
  }
  const line = timedOut
    ? notice === undefined
      ? plainNotice(name, raw, 'timed out')
      : notice
    : plainNotice(name, raw, `check failed: ${label}`);
  const message = [line, halfDone.trim()].filter(Boolean).join(' ');
  if (!message) return { code: 0 };
  return {
    code: 0,
    stdout: `${JSON.stringify({ systemMessage: message })}\n`,
    stderr: `${message}\n`,
  };
}

// The answer in `uncertain` block mode for hook `name` after `error` (a
// timeoutError when the hook ran
// out of time). `state.emitted` means the hook already wrote its answer;
// `state.cleared` means a prompt was fully checked; `state.sideEffect` names
// a change the hook had started (markSideEffect in lib/hook-io.js), which may
// now be half-done. Returns { stdout, stderr, code }.
export function failClosedAnswer(name, raw, state, error) {
  const label = errorLabel(error);
  const timedOut = error?.code === 'TIMEOUT';
  const why = timedOut
    ? `checking it took too long (over ${error.seconds} s)`
    : `it could not check it (${label})`;
  const halfDone = state.sideEffect
    ? ` ZeroH was ${state.sideEffect} when it ${timedOut ? 'ran out of time' : 'failed'}, so that may be half-done: run \`/zeroh-disclosure:doctor\` to check it.`
    : '';
  const retry =
    halfDone ||
    ' Try again; if it keeps happening, run `/zeroh-disclosure:doctor`.';
  if (name === 'user-prompt-submit') {
    if (state.cleared) {
      // The prompt was checked; only a half-done change is worth saying.
      return halfDone && !state.emitted
        ? {
            code: 0,
            stdout: `${JSON.stringify({ systemMessage: `🛡${halfDone}` })}\n`,
          }
        : { code: 0 };
    }
    const reason = timedOut
      ? `🛡 ${plainNotice(name, raw, 'timed out', 'block')} Nothing was sent.${retry}`
      : `🛡 ZeroH stopped this prompt: ${why}. Nothing was sent.${retry}`;
    // As lib/hook-io.js stopPrompt: the JSON answer keeps Claude Code from
    // repeating the prompt; exit code 2 stops it even without the JSON.
    return {
      code: 2,
      stdout: state.emitted
        ? ''
        : `${JSON.stringify({
            // deny-inventory: watchdog-block
            decision: 'block',
            reason,
            hookSpecificOutput: {
              hookEventName: 'UserPromptSubmit',
              suppressOriginalPrompt: true,
            },
          })}\n`,
      stderr: `${reason}\n`,
    };
  }
  if (name === 'pre-tool-use') {
    if (state.emitted) return { code: 0 };
    return {
      code: 0,
      stdout: `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          // deny-inventory: watchdog-block
          permissionDecision: 'deny',
          permissionDecisionReason: timedOut
            ? `🛡  ${plainNotice(name, raw, 'timed out', 'block')}${retry}`
            : `🛡  ZeroH Disclosure denied this tool call because its check failed unexpectedly.${retry}`,
        },
      })}\n`,
    };
  }
  if (name === 'post-tool-use') {
    const event = parse(raw);
    if (state.emitted || !event || event.tool_response === undefined) {
      return { code: 0 };
    }
    const filePath =
      event.tool_name === 'Read'
        ? event.tool_input?.file_path || event.tool_input?.path
        : null;
    const message = timedOut
      ? `${plainNotice(name, raw, 'timed out', 'block')} Try a smaller read; if it keeps happening, run \`/zeroh-disclosure:doctor\`.`
      : ERROR_WITHHELD;
    return {
      code: 0,
      stdout: `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          // deny-inventory: watchdog-block
          updatedToolOutput: withheldOutput(
            event.tool_name,
            event.tool_response,
            filePath,
            message,
          ),
        },
      })}\n`,
    };
  }
  // MessageDisplay answered, then ran out of time on its bookkeeping (the
  // vault's last-use save): exit 0, so Claude Code shows that answer, with
  // real values, instead of the delta with tokens.
  if (name === 'message-display' && state.emitted) return { code: 0 };
  // The other hooks guard nothing that could leak: Claude Code reports the
  // error and carries on (FAIL_CLOSED says what the user is left with).
  const hook = HOOKS[name] || name;
  const what = timedOut
    ? `the ${hook} hook timed out (over ${error.seconds} s) and was stopped`
    : `the ${hook} hook failed (${label})`;
  return {
    code: 1,
    stderr: `ZeroH Disclosure: ${what}: ${FAIL_CLOSED[name] || 'nothing was changed'}.${halfDone}\n`,
  };
}
