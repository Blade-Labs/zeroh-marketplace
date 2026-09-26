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
});

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

// The answer for hook `name` after `error`. `state.emitted` means the hook
// already wrote its answer; `state.cleared` means a prompt was fully checked.
// Returns { stdout, stderr, code }.
export function failClosedAnswer(name, raw, state, error) {
  const label = errorLabel(error);
  if (name === 'user-prompt-submit') {
    if (state.cleared) return { code: 0 };
    const reason = `🛡 ZeroH stopped this prompt: it could not check it (${label}). Try again; if it keeps happening, run \`/zeroh-disclosure:doctor\`.`;
    // As lib/hook-io.js stopPrompt: the JSON answer keeps Claude Code from
    // repeating the prompt; exit code 2 stops it even without the JSON.
    return {
      code: 2,
      stdout: state.emitted
        ? ''
        : `${JSON.stringify({
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
          permissionDecision: 'deny',
          permissionDecisionReason:
            '🛡  ZeroH Disclosure denied this tool call because its check failed unexpectedly. Try again; if it keeps happening, run `/zeroh-disclosure:doctor`.',
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
    return {
      code: 0,
      stdout: `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedToolOutput: withheldOutput(
            event.tool_name,
            event.tool_response,
            filePath,
            ERROR_WITHHELD,
          ),
        },
      })}\n`,
    };
  }
  // The other hooks guard nothing that could leak: Claude Code reports the
  // error and carries on (tokens stay tokens on screen, no receipt is signed).
  return {
    code: 1,
    stderr: `ZeroH Disclosure: the ${HOOKS[name] || name} hook failed (${label}).\n`,
  };
}
