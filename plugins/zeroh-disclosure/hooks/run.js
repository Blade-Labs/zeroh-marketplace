#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Every ZeroH hook runs through this loader: `node run.js <hook>`. It reads
// the event and runs the hook in a worker thread (./worker.js), so the loader
// stays in charge whatever the hook does: a hook that cannot even load (a
// syntax error, a missing or unreadable file, a module that throws while
// loading), that throws later, or that is still running two seconds before
// its hooks.json timeout (a runaway regex, a stuck file system) gets an answer
// from here, which says plainly what happened. What that answer is depends on
// the `uncertain` setting (packages/zeroh-disclosure-core/config.js uncertainMode):
//   - pass (the default; owner rule 2026-09-27: ZeroH adds masking where there
//     was none and must never stop Claude Code): the event goes on unchecked,
//     as Claude Code itself would do on a hook timeout, with a visible notice,
//     and a timeout is counted on the turn (packages/zeroh-disclosure-core/unchecked.js);
//   - block: the prompt is stopped, the tool call denied, the tool output
//     withheld (./fail-closed.js failClosedAnswer).
// A setting that cannot be read, or a lib/ that cannot load, is `pass`: a
// broken install must not brick Claude Code (D-10).
// The worker sends its output here; this thread writes it and sets the exit
// code. Recovery answers use Node built-ins and ./fail-closed.js only. The
// optional configuration read starts alongside the worker; a read that fails
// or never completes cannot prevent the final recovery notice.
import { Worker } from 'node:worker_threads';
import { writeSync } from 'node:fs';
import {
  failClosedAnswer,
  hookDeadlineMs,
  HOOKS,
  noticeSubject,
  oldNodeAnswer,
  passAnswer,
  timeoutError,
} from './fail-closed.js';

const hookStart = performance.now();
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
// hook may set ZeroH up again (see packages/zeroh-disclosure-core/uninstall-marker.js).
let standDown = false;
let removalFailure = null;
let removalOnly = false;
try {
  const {
    hookStandsDown,
    isUninstalled,
    readUninstallState,
    takeUninstallFailure,
    uninstallFailureNotice,
  } = await import('../packages/zeroh-disclosure-core/uninstall-marker.js');
  let event = null;
  try {
    event = JSON.parse(raw);
  } catch {
    // A hook reports a malformed event itself.
  }
  standDown = hookStandsDown(name, event);
  if (process.platform === 'win32') removalOnly = isUninstalled();
  if (
    standDown &&
    name === 'session-start' &&
    readUninstallState() === 'failed'
  ) {
    removalFailure =
      'ZeroH Disclosure removal incomplete · type /zeroh-disclosure:uninstall to finish';
  } else if (standDown && name === 'user-prompt-submit') {
    const failure = takeUninstallFailure();
    if (failure) removalFailure = uninstallFailureNotice(failure);
  }
} catch {
  // The check itself failed: the hook runs, failing closed as always.
}
if (standDown) {
  if (removalFailure) {
    process.stdout.write(
      `${JSON.stringify({ systemMessage: removalFailure })}\n`,
    );
  }
  process.exit(0);
}

// What the worker reports: whether the hook answered or cleared the prompt,
// and a change it has started (lib/hook-io.js).
const state = { emitted: false, cleared: false, sideEffect: null };

let finished = false;
// The worker has exited; a queued answer must still finish on stdout.
let exited = false;
// A clean scan can finish without an answer when there is nothing to rewrite.
let cleanNoOutput = false;
let failing = false;
let worker = null;
let serveWorkerSubprocesses = () => {};
let stopWindowsSubprocessHost = () => {};
let protectedHome = null;
let storagePreflight = false;
let subprocessNotice = null;
function noteSubprocessUnavailable() {
  subprocessNotice =
    'ZeroH subprocess service is unavailable; optional subprocess work could not run.';
  prepareEmergencyAnswer();
}
function withSubprocessNotice(answer) {
  if (subprocessNotice)
    answer.systemMessage = [answer.systemMessage, subprocessNotice]
      .filter(Boolean)
      .join('\n');
  return answer;
}
let bookkeepingWorker = null;
let bookkeepingDone = Promise.resolve();
let finishing = false;
// Reuse termination promises: requesting a stop is not evidence it completed.
const terminations = new WeakMap();
function terminate(worker) {
  if (!worker) return Promise.resolve();
  // Unix keeps the original termination requests at each call site.
  if (process.platform !== 'win32') return worker.terminate().catch(() => {});
  if (!terminations.has(worker))
    terminations.set(
      worker,
      worker.terminate().catch(() => {}),
    );
  return terminations.get(worker);
}
async function stopWorkers() {
  // Answers are already on stdout. Give native worker activity a short
  // join window, while the absolute exit watchdog remains in charge.
  await within(
    Promise.all([terminate(worker), terminate(bookkeepingWorker)]),
    100,
  );
}
let answerQueued = false;
let workerOutput = '';
let pendingWrites = 0;
let stdoutDone = Promise.resolve();
function writeStdout(data) {
  // Choosing an answer is irreversible once its bytes reach the pipe. A
  // second JSON value would make Claude Code discard both answers.
  if (answerQueued) return;
  answerQueued = true;
  pendingWrites += 1;
  const done = new Promise((resolve) => {
    process.stdout.write(data, () => {
      pendingWrites -= 1;
      resolve();
    });
  });
  stdoutDone = Promise.all([stdoutDone, done]);
}
function acceptWorkerOutput(data) {
  if (answerQueued) return;
  workerOutput += data;
  try {
    const answer = JSON.parse(workerOutput);
    if (subprocessNotice)
      workerOutput = `${JSON.stringify(withSubprocessNotice(answer))}\n`;
    if (name === 'user-prompt-submit' && answer?.decision === 'block')
      process.exitCode = 2;
  } catch {
    // Keep incomplete JSON off stdout so a timeout can replace it with one
    // complete notice/withhold answer, even if the worker set emitted early.
    return;
  }
  writeStdout(workerOutput);
  workerOutput = '';
}
async function finish(code) {
  if (finished) return;
  // A completed clean scan intentionally answers without stdout.
  if (cleanNoOutput) answerQueued = true;
  process.exitCode = code;
  if (finishing) return;
  finishing = true;
  // Stop synchronous worker code, but keep the watchdog alive until stdout
  // callbacks confirm delivery. process.exit() can discard a pipe's queue.
  void terminate(worker);
  while (pendingWrites) await stdoutDone;
  if (bookkeepingWorker) {
    await within(bookkeepingDone, 200, undefined);
  }
  // Preserve the original Unix finish path; native worker teardown runs only
  // on Windows. The hard watchdog still bounds a worker that never stops.
  if (process.platform === 'win32') {
    await stopWorkers();
    stopWindowsSubprocessHost();
  }
  finishing = false;
  finished = true;
  clearTimeout(timer);
  clearTimeout(hardTimer);
  clearTimeout(hardExitTimer);
  // Stdout has drained. A hung bookkeeping handle must not keep us alive.
  setImmediate(() => exitWithAnswer(code));
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
  const config = await import('../packages/zeroh-disclosure-core/config.js');
  const { projectRootFromEnv } =
    await import('../packages/zeroh-disclosure-core/session.js');
  try {
    await config.loadConfig({ cwd: projectRootFromEnv(event?.cwd) });
  } catch {
    // An unreadable config.env or .zeroh.env: the environment still counts.
  }
  return config.uncertainMode(process.env);
}

// The emergency answer never reads notice history: on the loader thread even
// a path lookup can block the watchdog (Astra review A1 on #650). It always
// carries the first-notice hint, so a turn may show the hint twice, never
// lose the notice.

// Counts a timeout on the turn (pass mode) and returns the notice to show,
// null when a timeout was already shown this turn.
async function countTimeout() {
  if (process.platform === 'win32') return startWindowsBookkeeping(true);
  const [{ recordUnchecked }, { projectRootFromEnv }] = await Promise.all([
    import('../packages/zeroh-disclosure-core/unchecked.js'),
    import('../packages/zeroh-disclosure-core/session.js'),
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

// Synchronous file-lock/rename retries must not run on
// the thread that owns the watchdog. A separate worker can finish the audit
// during the bounded stdout grace, even when the notice budget has expired.
function startWindowsBookkeeping(count, ok = true) {
  return new Promise((resolve) => {
    try {
      bookkeepingWorker = new Worker(
        new URL('./timeout-bookkeeping.js', import.meta.url),
        {
          workerData: {
            name,
            event,
            raw,
            count,
            ok,
            storagePreflight,
            protectedHome,
          },
        },
      );
      serveWorkerSubprocesses(bookkeepingWorker, {
        onUnavailable: noteSubprocessUnavailable,
      });
      bookkeepingDone = new Promise((done) =>
        bookkeepingWorker.once('exit', done),
      );
      bookkeepingWorker.on('message', (message) => {
        if (message?.type !== 'subprocess') resolve(message);
      });
      bookkeepingWorker.once('error', () => resolve(undefined));
      bookkeepingWorker.once('exit', () => resolve(undefined));
    } catch {
      resolve(undefined);
    }
  });
}

// Every hook run touches the session's heartbeat and records the hook's
// health for the status line (packages/zeroh-disclosure-core/session-status.js): a crash or a load
// failure turns it red until the same hook succeeds again. A timeout is
// counted as an unprotected pass instead (countTimeout). Best effort, and
// within a short budget: the answer has already been written.
async function recordRun(ok) {
  const [{ recordHookRun }, { projectRootFromEnv }, { isUninstalled }] =
    await Promise.all([
      import('../packages/zeroh-disclosure-core/session-status.js'),
      import('../packages/zeroh-disclosure-core/session.js'),
      import('../packages/zeroh-disclosure-core/uninstall-marker.js'),
    ]);
  // This very hook ran `/zeroh-disclosure:uninstall`: ZEROH_HOME keeps
  // only the tombstone.
  if (isUninstalled()) return;
  recordHookRun({
    cwd: projectRootFromEnv(event?.cwd),
    sessionId: event?.session_id,
    name,
    ok,
  });
  await sweepRunFiles();
}

// Late-binding values files of commands that never ran (refused by Claude
// Code, denied, cancelled) must not wait for the next session: every hook
// removes any older than RUN_FILE_MAX_AGE_MS, a turn boundary removes the
// session's own older than TURN_END_GRACE_MS, and SessionEnd all of them.
async function sweepRunFiles() {
  const { cleanupSessionRunFiles, cleanupStaleRunFiles, TURN_END_GRACE_MS } =
    await import('../packages/shell-analysis/late-bind.js');
  try {
    cleanupStaleRunFiles();
  } catch {
    // A file held open (Windows antivirus) goes at a later hook.
  }
  const minAgeMs = {
    stop: TURN_END_GRACE_MS,
    'user-prompt-submit': TURN_END_GRACE_MS,
    'session-end': 0,
  }[name];
  if (minAgeMs === undefined) return;
  try {
    cleanupSessionRunFiles({ sessionId: event?.session_id, minAgeMs });
  } catch {
    // As above.
  }
}

async function fail(error) {
  if (
    finished ||
    failing ||
    cleanNoOutput ||
    (exited && answerQueued && !pendingWrites)
  )
    return;
  failing = true;
  fallbackError = error;
  prepareEmergencyAnswer();
  const fallbackStart = performance.now();
  void terminate(worker);
  if (answerQueued) {
    // The complete protective answer owns stdout, including during the
    // bounded drain grace. Never append a timeout answer behind it.
    finish(process.exitCode ?? 0);
    return;
  }
  workerOutput = '';
  const answerState = { ...state, emitted: false };
  // Windows status persistence can synchronously wait
  // on a rename. Promise.race cannot bound that synchronous work; running it
  // before choosing the answer can let hardTimer exit with empty stdout.
  const windows = process.platform === 'win32';
  if (windows) await modeReady;
  else
    await Promise.all([
      within(recordRun(error?.code === 'TIMEOUT'), 300, undefined),
      modeReady,
    ]);
  const mode = fallbackMode;
  let answer;
  if (mode === 'block') {
    answer = failClosedAnswer(name, raw, answerState, error);
  } else {
    // Only the hooks that guard content pass something unprotected; a slow
    // SessionStart, MessageDisplay, Stop or SessionEnd is not counted.
    const guards = ['user-prompt-submit', 'pre-tool-use', 'post-tool-use'];
    const notice =
      error?.code === 'TIMEOUT' && guards.includes(name)
        ? await within(
            countTimeout(),
            windows
              ? Math.max(1, 800 - (performance.now() - fallbackStart))
              : 300,
            undefined,
          )
        : undefined;
    if (notice !== undefined) {
      timeoutNoticeRecorded = true;
      fallbackNotice = notice;
      prepareEmergencyAnswer();
    }
    answer = passAnswer(name, raw, answerState, error, {
      notice: notice === undefined ? fallbackNotice : notice,
    });
  }
  if (finished) return;
  // Set the code before any writes or teardown can reach the hard exit.
  process.exitCode = answer.code;
  if (answer.stdout) {
    if (subprocessNotice) {
      try {
        answer.stdout = `${JSON.stringify(withSubprocessNotice(JSON.parse(answer.stdout)))}\n`;
      } catch {
        /* Plain hook output. */
      }
    }
    writeStdout(answer.stdout);
  } else answerQueued = true; // An intentionally quiet answer is final too.
  if (answer.stderr) process.stderr.write(answer.stderr);
  if (windows && !bookkeepingWorker)
    void startWindowsBookkeeping(false, error?.code === 'TIMEOUT');
  finish(answer.code);
}

const deadline = hookDeadlineMs(name, process.env);
let fallbackMode = 'pass';
let fallbackError = timeoutError(deadline);
let fallbackNotice;
let timeoutNoticeRecorded = false;
let emergencyAnswer;
function prepareEmergencyAnswer() {
  // Worker state alone is not a delivered answer. Until stdout is queued,
  // keep one complete notice/deny/withhold ready, using only pure builders.
  // Keep `cleared`: a prompt already found safe needs no deny or notice.
  const answerState = { ...state, emitted: false };
  let answer;
  try {
    answer = (fallbackMode === 'block' ? failClosedAnswer : passAnswer)(
      name,
      raw,
      answerState,
      fallbackError,
      { notice: fallbackNotice },
    );
  } catch {
    // Never let the standby answer break a healthy hook; keep the last one.
    return;
  }
  if (answer.stdout && subprocessNotice) {
    try {
      answer.stdout = `${JSON.stringify(withSubprocessNotice(JSON.parse(answer.stdout)))}\n`;
    } catch {
      /* Plain hook output. */
    }
  }
  if (answer.stdout) answer.stdout = Buffer.from(answer.stdout);
  if (answer.stderr) answer.stderr = Buffer.from(answer.stderr);
  emergencyAnswer = answer;
}
const emergencyPause = new Int32Array(new SharedArrayBuffer(4));
function writeEmergency(fd, data) {
  if (!data) return;
  // A descriptor write may consume only part of a buffer. Drain the
  // precomputed bytes synchronously rather than exit with truncated JSON.
  // A non-blocking pipe can refuse bytes for a moment (EAGAIN); a closed
  // reader cannot be helped. Either way the exit code below must still run.
  let offset = 0;
  let waits = 0;
  while (offset < data.length) {
    try {
      offset += writeSync(fd, data, offset, data.length - offset);
    } catch (error) {
      if (error?.code !== 'EAGAIN' || ++waits > 50) return;
      Atomics.wait(emergencyPause, 0, 0, 10);
    }
  }
}
function exitWithAnswer(code) {
  if (!answerQueued && emergencyAnswer) {
    // No imports, config reads, bookkeeping or stream callbacks at exit.
    // The hard watchdog cannot wait for another asynchronous stdout drain.
    answerQueued = true;
    code = emergencyAnswer.code;
    process.exitCode = code;
    writeEmergency(1, emergencyAnswer.stdout);
    // Stderr is best effort; the answer and its exit code come first.
    writeEmergency(2, emergencyAnswer.stderr);
  }
  process.exit(code);
}
const remainingDeadline =
  process.platform === 'win32'
    ? Math.max(1, deadline - (performance.now() - hookStart))
    : deadline;
const timer = setTimeout(() => fail(timeoutError(deadline)), remainingDeadline);
// 1 s after the watchdog: PostToolUse exits by 14 s, before hooks.json's
// 15 s kill. This bound also covers stdout that never drains and unfinished
// async bookkeeping. Timeout answer construction gets at most 800 ms above.
const hardTimer = setTimeout(() => {
  // Starting a join must never shorten the stdout drain grace.
  void stopWorkers();
}, remainingDeadline + 900);
// Reserve the final 100 ms for the join, without moving the original bound.
const hardExitTimer = setTimeout(() => {
  exitWithAnswer(process.exitCode ?? 0);
}, remainingDeadline + 1000);
prepareEmergencyAnswer();

// Start the same configurable mode read alongside worker startup, bounded
// by the original 500 ms wait budget. A missing/unreadable config is pass
// (D-10), with a precomputed notice rather than a silent hard exit. A read
// finishing later still updates the best-known mode without extending any
// wait or deadline; unknown remains pass until that read actually succeeds.
const modeReady = within(
  readMode().then((mode) => {
    fallbackMode = mode;
    prepareEmergencyAnswer();
  }),
  500,
);

async function startWorker() {
  // Keep adapter loading inside the fallback and watchdog boundary. Unix
  // recovery must not depend on this Windows-only service.
  if (process.platform === 'win32') {
    const adapter =
      await import('../packages/zeroh-disclosure-core/child-process.js');
    if (
      typeof adapter.startWindowsSubprocessHost !== 'function' ||
      typeof adapter.execFileSync !== 'function' ||
      typeof adapter.serveWorkerSubprocesses !== 'function'
    )
      throw new Error('Windows subprocess adapter is invalid');
    ({ serveWorkerSubprocesses, stopWindowsSubprocessHost } = adapter);
    const { prepareWindowsHome } =
      await import('../packages/zeroh-disclosure-core/private-fs.js');

    storagePreflight = true;
    try {
      // Uninstall retries may run management code, but must never recreate
      // storage metadata in a tombstoned installation.
      if (!removalOnly)
        protectedHome = prepareWindowsHome({
          timeout: Math.max(
            1,
            Math.min(1800, (deadline - (performance.now() - hookStart)) / 3),
          ),
          execute: adapter.execFileSync,
        });
    } catch {
      // An unavailable home uses the ordinary ephemeral/in-memory paths.
    }
    // A watchdog may still be constructing or draining its answer. Leave
    // exit ownership with finish and the hard watchdog instead of racing it.
    if (failing || finished) return;
    let needsHost = name === 'session-start' || name === 'user-prompt-submit';
    if (
      name === 'post-tool-use' &&
      event?.tool_name === 'Read' &&
      /\.pdf$/iu.test(
        event.tool_input?.file_path || event.tool_input?.path || '',
      )
    ) {
      const { pdftotextCommand } =
        await import('../packages/zeroh-disclosure-core/pdf-text.js');
      needsHost = Boolean(pdftotextCommand());
    }
    if (needsHost) {
      try {
        await adapter.startWindowsSubprocessHost(noteSubprocessUnavailable);
      } catch {
        noteSubprocessUnavailable();
      }
    }
    if (failing || finished) return;
  }
  worker = new Worker(new URL('./worker.js', import.meta.url), {
    workerData: {
      name,
      ...(process.platform === 'win32'
        ? { storagePreflight, protectedHome }
        : {}),
      input: raw,
      hookStartEpoch: performance.timeOrigin + hookStart,
    },
    stdout: true,
    stderr: true,
  });
  if (process.platform === 'win32')
    serveWorkerSubprocesses(worker, {
      onUnavailable: noteSubprocessUnavailable,
    });
  worker.on('message', (message) => {
    if (finished || failing || !message || typeof message !== 'object') return;
    if (message.type === 'stdout') acceptWorkerOutput(message.data);
    else if (message.type === 'stderr') process.stderr.write(message.data);
    else if (message.type === 'state') {
      Object.assign(state, message.state);
      if (!answerQueued) prepareEmergencyAnswer();
    } else if (message.type === 'error') fail(message.error);
  });
  worker.on('error', fail);
  worker.on('exit', (code) => {
    if (failing) return;
    exited = true;
    if (subprocessNotice && code === 0 && !answerQueued && !workerOutput)
      writeStdout(`${JSON.stringify(withSubprocessNotice({}))}\n`);
    cleanNoOutput = code === 0 && !answerQueued && !workerOutput;
    if (workerOutput) {
      // Non-JSON output is supported by non-guarding hooks (e.g. Stop).
      // A guarding hook's incomplete answer must use the recovery path.
      if (
        ['user-prompt-submit', 'pre-tool-use', 'post-tool-use'].includes(name)
      ) {
        fail({ code: 'INCOMPLETE_OUTPUT' });
        return;
      }
      writeStdout(workerOutput);
    }
    // Keep the deadline through stdout completion, including a large pipe.
    within(recordRun(true), 300, undefined).finally(() => finish(code));
  });
}
try {
  await startWorker();
} catch (error) {
  fail(error);
}
