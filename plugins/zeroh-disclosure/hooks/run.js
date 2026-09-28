#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Every ZeroH hook runs through this loader: `node run.js <hook>`. It reads
// the event and runs the hook in a worker thread (./worker.js), so the loader
// stays in charge whatever the hook does: a hook that cannot even load (a
// syntax error, a missing or unreadable file, a module that throws while
// loading), that throws later, or that is still running two seconds before
// its hooks.json timeout (a runaway regex, a stuck file system) gets an answer
// from here, which says plainly what happened. What that answer is depends on
// the `uncertain` setting (lib/config.js uncertainMode):
//   - pass (the default; owner rule 2026-09-27: ZeroH adds masking where there
//     was none and must never stop Claude Code): the event goes on unchecked,
//     as Claude Code itself would do on a hook timeout, with a visible notice,
//     and a timeout is counted on the turn (lib/unchecked.js);
//   - block: the prompt is stopped, the tool call denied, the tool output
//     withheld (./fail-closed.js failClosedAnswer).
// A setting that cannot be read, or a lib/ that cannot load, is `pass`: a
// broken install must not brick Claude Code (D-10).
// The worker sends its output here; this thread writes it and sets the exit
// code. The loader uses Node built-ins, ./fail-closed.js and
// lib/uninstall-marker.js only until the hook has answered.
import { Worker } from 'node:worker_threads';
import {
  failClosedAnswer,
  hookDeadlineMs,
  HOOKS,
  noticeSubject,
  oldNodeAnswer,
  passAnswer,
  timeoutError,
} from './fail-closed.js';

const name = process.argv[2];
if (!Object.hasOwn(HOOKS, name)) {
  process.stderr.write(`ZeroH Disclosure: unknown hook "${name}".\n`);
  process.exit(1);
}

// Node.js 20 or later (LP-B6): see oldNodeAnswer.
const oldNode = oldNodeAnswer(name, process.versions.node);
if (oldNode) {
  if (oldNode.stdout) process.stdout.write(oldNode.stdout);
  process.exit(0);
}

let raw = '';
if (!process.stdin.isTTY) {
  for await (const chunk of process.stdin) raw += chunk;
}
// After `uninstall` (T-38) a session still running does nothing more: no
// hook may set ZeroH up again (see lib/uninstall-marker.js).
let standDown = false;
try {
  const { hookStandsDown } = await import('../lib/uninstall-marker.js');
  let event = null;
  try {
    event = JSON.parse(raw);
  } catch {
    // A hook reports a malformed event itself.
  }
  standDown = hookStandsDown(name, event);
} catch {
  // The check itself failed: the hook runs, failing closed as always.
}
if (standDown) process.exit(0);

// What the worker reports: whether the hook answered or cleared the prompt,
// and a change it has started (lib/hook-io.js).
const state = { emitted: false, cleared: false, sideEffect: null };

let finished = false;
// The worker has exited: its answer stands, whatever happens after.
let exited = false;
let failing = false;
let worker = null;
function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  process.exitCode = code;
  // Ends a worker still stuck in synchronous code; the answer is written.
  worker?.terminate().catch(() => {});
  setImmediate(() => process.exit(code));
}

let event = null;
try {
  event = JSON.parse(raw);
} catch {
  // The hook reports a malformed event itself.
}

// Resolves to `fallback` when `promise` does not settle within `ms`: the
// loader's own work after a timeout must fit in the time that is left.
function within(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms).unref()),
  ]);
}

async function readMode() {
  const config = await import('../lib/config.js');
  const { projectRootFromEnv } = await import('../lib/session.js');
  try {
    await config.loadConfig({ cwd: projectRootFromEnv(event?.cwd) });
  } catch {
    // An unreadable config.env or .zeroh.env: the environment still counts.
  }
  return config.uncertainMode(process.env);
}

// Counts a timeout on the turn (pass mode) and returns the notice to show,
// null when a timeout was already shown this turn.
async function countTimeout() {
  const [{ recordUnchecked }, { projectRootFromEnv }] = await Promise.all([
    import('../lib/unchecked.js'),
    import('../lib/session.js'),
  ]);
  const { notice } = await recordUnchecked({
    reason: 'watchdog-timeout',
    tool: name === 'user-prompt-submit' ? HOOKS[name] : event?.tool_name,
    cwd: projectRootFromEnv(event?.cwd),
    sessionId: event?.session_id,
    subject: noticeSubject(name, raw),
  });
  return notice;
}

// Every hook run touches the session's heartbeat and records the hook's
// health for the status line (lib/session-status.js): a crash or a load
// failure turns it red until the same hook succeeds again. A timeout is
// counted as an unprotected pass instead (countTimeout). Best effort, and
// within a short budget: the answer has already been written.
async function recordRun(ok) {
  const [{ recordHookRun }, { projectRootFromEnv }] = await Promise.all([
    import('../lib/session-status.js'),
    import('../lib/session.js'),
  ]);
  recordHookRun({
    cwd: projectRootFromEnv(event?.cwd),
    sessionId: event?.session_id,
    name,
    ok,
  });
}

async function fail(error) {
  if (finished || failing || exited) return;
  failing = true;
  await within(recordRun(error?.code === 'TIMEOUT'), 300, undefined);
  const mode = await within(readMode(), 500, 'pass');
  let answer;
  if (mode === 'block') {
    answer = failClosedAnswer(name, raw, state, error);
  } else {
    // Only the hooks that guard content pass something unprotected; a slow
    // SessionStart, MessageDisplay, Stop or SessionEnd is not counted.
    const guards = ['user-prompt-submit', 'pre-tool-use', 'post-tool-use'];
    const notice =
      error?.code === 'TIMEOUT' && guards.includes(name)
        ? await within(countTimeout(), 700, undefined)
        : undefined;
    answer = passAnswer(name, raw, state, error, { notice });
  }
  if (finished) return;
  if (answer.stdout) process.stdout.write(answer.stdout);
  if (answer.stderr) process.stderr.write(answer.stderr);
  finish(answer.code);
}

const deadline = hookDeadlineMs(name, process.env);
const timer = setTimeout(() => fail(timeoutError(deadline)), deadline);

try {
  worker = new Worker(new URL('./worker.js', import.meta.url), {
    workerData: { name, input: raw },
    stdout: true,
    stderr: true,
  });
  worker.on('message', (message) => {
    if (finished || failing || !message || typeof message !== 'object') return;
    if (message.type === 'stdout') process.stdout.write(message.data);
    else if (message.type === 'stderr') process.stderr.write(message.data);
    else if (message.type === 'state') Object.assign(state, message.state);
    else if (message.type === 'error') fail(message.error);
  });
  worker.on('error', fail);
  worker.on('exit', (code) => {
    if (failing) return;
    exited = true;
    clearTimeout(timer);
    // The answer is written; record the run, then leave.
    within(recordRun(true), 300, undefined).finally(() => finish(code));
  });
} catch (error) {
  fail(error);
}
