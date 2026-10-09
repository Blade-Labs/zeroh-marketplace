// SPDX-License-Identifier: AGPL-3.0-only

// rc.2 item 5: the hook watchdog. Every hook runs in a worker thread; the
// loader answers fail-closed at the hook's timeout minus 2 s, even when the
// hook is stuck in synchronous code (a runaway regex), and says so plainly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { FAKE_STRIPE, PLUGIN, tempProject } from '../helpers.mjs';
import {
  failClosedAnswer,
  HOOK_TIMEOUTS,
  hookDeadlineMs,
  passAnswer,
  timeoutError,
} from '../../hooks/fail-closed.js';
import {
  markUninstallPending,
  markUninstalled,
} from '../../packages/zeroh-disclosure-core/uninstall-marker.js';
import { sessionDir } from '../../packages/zeroh-disclosure-core/session.js';
import { prepareWindowsHome } from '../../packages/zeroh-disclosure-core/private-fs.js';
import {
  hookChildDiagnostics as childDiagnostics,
  runHookChild,
} from '../tools/hook-child.mjs';

function hookChildDiagnostics(result) {
  return `${childDiagnostics(result)}; probes=${result.probeTrace ?? ''}`;
}

function replaceAnchored(source, before, after) {
  assert.ok(
    source.includes(before),
    `missing loader fixture anchor: ${before}`,
  );
  return source.replace(before, after);
}

// Instrument only the fixture copy. fd 3 is independent of product stdout
// and stderr, including synchronous emergency writes and WIN14 diagnostics.
function traceNoticeSelection(plugin) {
  const runner = path.join(plugin, 'hooks/run.js');
  let source = readFileSync(runner, 'utf8').replace(/^#![^\n]*\n/u, '');
  const replace = (before, after) => {
    source = replaceAnchored(source, before, after);
  };
  replace(
    'function startWindowsBookkeeping(count, ok = true) {\n  return new Promise((resolve) => {',
    `function startWindowsBookkeeping(count, ok = true) {
      return new Promise((settle) => {
        let settled = false;
        const resolve = (value, failure) => {
          if (settled) return;
          settled = true;
          if (failure) {
            bookkeepingFailure = failure;
            watchdogProbe({ type: 'bookkeeping-failure', failure });
          }
          settle(value);
        };`,
  );
  replace(
    "bookkeepingWorker.once('error', () => resolve(undefined));",
    "bookkeepingWorker.once('error', () => resolve(undefined, 'worker-error'));",
  );
  replace(
    "bookkeepingWorker.once('exit', () => resolve(undefined));",
    "bookkeepingWorker.once('exit', () => resolve(undefined, terminations.has(bookkeepingWorker) ? null : 'worker-exit'));",
  );
  replace(
    '    } catch {\n      resolve(undefined);',
    "    } catch {\n      resolve(undefined, 'worker-construction');",
  );
  replace(
    '? await within(\n            countTimeout(),',
    '? await noticeWithin(\n            countTimeout(),',
  );
  replace(
    'writeEmergency(1, emergencyAnswer.stdout);',
    "writeEmergency(1, emergencyAnswer.stdout);\n    watchdogProbe({ type: 'emergency-emission' });",
  );
  writeFileSync(
    runner,
    `import { writeSync as writeProbe } from 'node:fs';
     const watchdogProbe = value => {
       try { writeProbe(3, JSON.stringify(value) + '\\n'); } catch {}
     };
     let bookkeepingFailure = null;
     function noticeWithin(promise, ms, fallback) {
       let settled = false;
       const finish = (source, value) => {
         if (!settled) {
           settled = true;
           watchdogProbe({ type: 'notice-wait', source,
             value: value === undefined ? 'undefined' : value });
         }
         return value;
       };
       return Promise.race([
         Promise.resolve(promise).then(
           value => finish(bookkeepingFailure ? 'failure' : 'result', value),
           () => finish('rejection', fallback)),
         new Promise(resolve => setTimeout(
           () => resolve(finish('budget', fallback)), ms).unref()),
       ]);
     }\n` + source,
  );
}

// Completion/error fixtures test loader wiring outside the best-effort race.
// Keep both worker teardown and hard exit beyond the generous notice budget;
// other fixtures retain the production deadlines and recovery timers.
function widenBookkeepingRace(plugin) {
  const runner = path.join(plugin, 'hooks/run.js');
  let source = readFileSync(runner, 'utf8');
  for (const [before, after] of [
    [
      '800 - (performance.now() - fallbackStart)',
      '15000 - (performance.now() - fallbackStart)',
    ],
    [': 300,\n            undefined,', ': 15000,\n            undefined,'],
    ['remainingDeadline + 900', 'remainingDeadline + 16000'],
    ['remainingDeadline + 1000', 'remainingDeadline + 17000'],
  ])
    source = replaceAnchored(source, before, after);
  writeFileSync(runner, source);
}

const busyLoopPlugins = new Set();
function pluginWithBusyLoop(name, body) {
  const plugin = pluginWith(name, body);
  busyLoopPlugins.add(plugin);
  return plugin;
}

// A copy of the plugin whose `name` hook body is `body`.
function pluginWith(name, body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zeroh-watchdog-plugin-'));
  for (const entry of [
    'hooks',
    'lib',
    'bin',
    'packages',
    '.claude-plugin',
    'vendor',
  ]) {
    cpSync(path.join(PLUGIN, entry), path.join(dir, entry), {
      recursive: true,
    });
  }
  cpSync(path.join(PLUGIN, 'package.json'), path.join(dir, 'package.json'));
  writeFileSync(path.join(dir, 'hooks', `${name}.js`), body);
  traceNoticeSelection(dir);
  return dir;
}

function run(pluginDir, name, event, project, extraEnv = {}) {
  return runHookChild(
    () => runOnce(pluginDir, name, event, project, extraEnv),
    name,
    { deliberateBusyLoop: busyLoopPlugins.has(pluginDir) },
  );
}

async function runOnce(pluginDir, name, event, project, extraEnv) {
  const started = performance.now();
  const child = spawn(
    process.execPath,
    [path.join(pluginDir, 'hooks', 'run.js'), name],
    {
      env: fixtureEnv(project, extraEnv),
      timeout: 40000,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    },
  );
  const res = { stdout: '', stderr: '', probeTrace: '' };
  child.stdio[3].setEncoding('utf8');
  child.stdio[3].on('data', (chunk) => {
    res.probeTrace += chunk;
  });
  let readyAt = null;
  let outputAt = null;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    outputAt ??= performance.now();
    res.stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    res.stderr += chunk;
    if (readyAt === null && res.stderr.includes('ZEROH_WATCHDOG_READY\n'))
      readyAt = performance.now();
  });
  const closed = once(child, 'close');
  child.stdin.end(
    JSON.stringify({ session_id: 'watchdog', cwd: project.dir, ...event }),
  );
  const [code, signal] = await closed;
  const finished = performance.now();
  res.stderr = res.stderr.replace('ZEROH_WATCHDOG_READY\n', '');
  // Like READY above, these are test-owned probes, not product stderr.
  // Keep them separately so an otherwise empty-stderr native V8 crash
  // still qualifies for the unchanged WIN14 retry rule.
  const probePattern = /ZEROH_(?:MODE_READ_STARTED|HARD_EXIT_FALLBACK)\n/gu;
  const probeTrace =
    res.probeTrace + (res.stderr.match(probePattern)?.join('') || '');
  res.stderr = res.stderr.replace(probePattern, '');
  const out = res.stdout.trim();
  let json = null;
  try {
    json = out ? JSON.parse(out.split('\n').pop()) : null;
  } catch {
    // Plain output: the test reads stdout.
  }
  return {
    status: code,
    code,
    signal,
    stdout: res.stdout,
    stderr: res.stderr,
    probeTrace,
    probes: res.probeTrace
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    json,
    ms: finished - started,
    watchdogMs: readyAt === null ? null : finished - readyAt,
    outputMs: readyAt === null || outputAt === null ? null : outputAt - readyAt,
  };
}

function fixtureEnv(project, extraEnv = {}) {
  return {
    PATH: process.env.PATH,
    HOME: project.home,
    USERPROFILE: project.home,
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    PATHEXT: process.env.PATHEXT,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: project.settings,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    ZEROH_CLAUDE_BIN: process.env.ZEROH_CLAUDE_BIN,
    ZEROH_PROXY: 'off',
    CLAUDE_PROJECT_DIR: project.dir,
    TMPDIR: os.tmpdir(),
    TMP: os.tmpdir(),
    TEMP: os.tmpdir(),
    ...extraEnv,
  };
}

const HANG = "process.stderr.write('ZEROH_WATCHDOG_READY\\n'); for (;;) {}\n";
const FAST = { ZEROH_HOOK_DEADLINE_MS: '1500' };
const BLOCK = { ...FAST, ZEROH_UNCERTAIN: 'block' };

for (const mode of ['pass', 'block'])
  test(`WIN11 Windows startup completing during watchdog fallback preserves its answer (${mode})`, async () => {
    const project = tempProject({ env: false });
    const plugin = pluginWith(
      'session-start',
      "throw new Error('ZEROHFAKE worker must not start');",
    );
    const ready = path.join(project.dir, 'fallback-ready');
    writeFileSync(
      path.join(plugin, 'packages/zeroh-disclosure-core/config.js'),
      `export async function loadConfig() {
         await new Promise(resolve => setTimeout(resolve, 200));
       }
       export const uncertainMode = () => ${JSON.stringify(mode)};`,
    );
    // Startup mode loading is now parallel. Signal the actual fallback,
    // rather than treating a config read as evidence the watchdog fired.
    const runner = path.join(plugin, 'hooks/run.js');
    writeFileSync(
      runner,
      `import { writeFileSync as markFallback } from 'node:fs';\n` +
        readFileSync(runner, 'utf8')
          .replace(/^#![^\n]*\n/u, '')
          .replace(
            'failing = true;',
            `failing = true; markFallback(${JSON.stringify(ready)}, 'ZEROHFAKE');`,
          ),
    );
    writeFileSync(
      path.join(plugin, 'packages/zeroh-disclosure-core/child-process.js'),
      `import { existsSync } from 'node:fs';
       export const execFileSync = () => { throw new Error('ZEROHFAKE ACL unavailable'); };
       export const serveWorkerSubprocesses = () => {};
       export const stopWindowsSubprocessHost = () => {};
       export async function startWindowsSubprocessHost() {
         while (!existsSync(${JSON.stringify(ready)}))
           await new Promise(resolve => setTimeout(resolve, 5));
       }`,
    );
    const result = await run(
      plugin,
      'session-start',
      { source: 'startup' },
      project,
      {
        ...FAST,
        NODE_OPTIONS:
          '--import=' +
          pathToFileURL(
            path.join(PLUGIN, 'test/tools/worker-child-process-preload.mjs'),
          ).href,
        ZEROH_WORKER_TEST_TRACE: path.join(project.dir, 'startup-trace'),
      },
    );
    assert.equal(result.signal, null, hookChildDiagnostics(result));
    assert.match(
      result.stderr,
      /SessionStart hook timed out/u,
      hookChildDiagnostics(result),
    );
    assert.doesNotMatch(
      result.stderr,
      /worker must not start/u,
      hookChildDiagnostics(result),
    );
    assert.equal(result.code, 1, hookChildDiagnostics(result));
  });

const EVENTS = {
  'session-start': { source: 'startup' },
  'user-prompt-submit': { prompt: `deploy with ${FAKE_STRIPE}` },
  'pre-tool-use': { tool_name: 'Bash', tool_input: { command: 'echo hi' } },
  'post-tool-use': {
    tool_name: 'Read',
    tool_input: { file_path: '.env' },
    tool_response: {
      type: 'text',
      file: { filePath: '.env', content: `STRIPE_KEY=${FAKE_STRIPE}` },
    },
  },
  'message-display': { delta: 'hello' },
  stop: {},
  'session-end': {},
};

// Stall only the copied loader's normal fallback, leaving its original
// watchdog and hard-exit timers intact. Also force partial fd-1 writes to
// prove the emergency path drains a complete JSON value. No product switch.
function delayFallback(plugin, { unknownMode = false } = {}) {
  // The 800 ms mode read exceeds the startup wait budget, but completes
  // before the deadline: its late result must still be the best-known mode.
  const runner = path.join(plugin, 'hooks', 'run.js');
  writeFileSync(
    runner,
    `import fsProbe, { writeSync as probeWrite } from 'node:fs';
     import { syncBuiltinESMExports } from 'node:module';
     const originalWrite = fsProbe.writeSync;
     fsProbe.writeSync = (...args) => {
       const [fd, data, offset = 0, length] = args;
       if (fd !== 1) return originalWrite(...args);
       if (typeof data === 'string')
         return originalWrite(fd, Buffer.from(data).subarray(0, 7));
       return originalWrite(fd, data, offset, Math.min(length ?? data.length - offset, 7));
     };
     syncBuiltinESMExports();\n` +
      readFileSync(runner, 'utf8')
        .replace(/^#![^\n]*\n/u, '')
        .replace(
          'const fallbackStart = performance.now();',
          `await new Promise(resolve => setTimeout(resolve, 10000));
           const fallbackStart = performance.now();`,
        )
        .replace(
          'async function readMode() {',
          `async function readMode() {
             probeWrite(2, 'ZEROH_MODE_READ_STARTED\\n');
             await new Promise(resolve => setTimeout(resolve, ${unknownMode ? 10000 : 800}));`,
        )
        .replace(
          'const hardExitTimer = setTimeout(() => {',
          `const hardExitTimer = setTimeout(() => {
             probeWrite(2, 'ZEROH_HARD_EXIT_FALLBACK\\n');`,
        ),
  );
}

for (const injectedWindows of [false, true])
  for (const mode of ['pass', 'block'])
    test(`WIN15 hard exit delivers the configured ${mode} answer for every guarded hook (${injectedWindows ? 'injected Windows' : 'native platform'})`, async (t) => {
      for (const name of [
        'user-prompt-submit',
        'pre-tool-use',
        'post-tool-use',
      ])
        await t.test(name, async () => {
          const project = tempProject({ env: false });
          const plugin = pluginWithBusyLoop(name, HANG);
          delayFallback(plugin);
          // Exercise each original config route, including repository
          // tightening of an explicitly looser environment setting.
          const extraEnv = { ...FAST, ZEROH_UNCERTAIN: 'pass' };
          if (name === 'user-prompt-submit') {
            delete extraEnv.ZEROH_UNCERTAIN;
            writeFileSync(
              path.join(project.home, 'config.env'),
              `ZEROH_UNCERTAIN=${mode}\n`,
            );
          } else if (name === 'pre-tool-use') {
            writeFileSync(
              path.join(project.dir, '.zeroh.env'),
              `ZEROH_UNCERTAIN=${mode}\n`,
            );
          } else extraEnv.ZEROH_UNCERTAIN = mode;
          if (injectedWindows) {
            extraEnv.ZEROH_WORKER_TEST_TRACE = path.join(project.dir, 'trace');
            extraEnv.NODE_OPTIONS = [
              process.env.NODE_OPTIONS,
              '--import=' +
                pathToFileURL(
                  path.join(
                    PLUGIN,
                    'test/tools/worker-child-process-preload.mjs',
                  ),
                ).href,
            ]
              .filter(Boolean)
              .join(' ');
          }
          const result = await run(
            plugin,
            name,
            EVENTS[name],
            project,
            extraEnv,
          );
          const diagnostics = `${name}: ${hookChildDiagnostics(result)}; probes=${result.probeTrace}`;
          assert.equal(result.signal, null, diagnostics);
          assert.notEqual(result.watchdogMs, null, diagnostics);
          assert.match(
            result.probeTrace,
            /ZEROH_HARD_EXIT_FALLBACK/u,
            diagnostics,
          );
          assert.ok(
            result.probes.some((probe) => probe.type === 'emergency-emission'),
            diagnostics,
          );
          const raw = JSON.stringify({
            session_id: 'watchdog',
            cwd: project.dir,
            ...EVENTS[name],
          });
          const expected = (mode === 'block' ? failClosedAnswer : passAnswer)(
            name,
            raw,
            { emitted: false, cleared: false, sideEffect: null },
            timeoutError(Number(FAST.ZEROH_HOOK_DEADLINE_MS)),
          );
          assert.equal(result.code, expected.code, diagnostics);
          assert.equal(result.stdout, expected.stdout, diagnostics);
          assert.equal(
            result.probeTrace.match(/ZEROH_MODE_READ_STARTED/gu)?.length,
            1,
            diagnostics,
          );
          assert.equal(result.stderr, expected.stderr || '', diagnostics);
          assert.equal(result.stdout.trim().split('\n').length, 1, diagnostics);
          assert.deepEqual(JSON.parse(result.stdout), result.json, diagnostics);
          assert.ok(result.watchdogMs < 3500, diagnostics);
        });
    });

// A prompt the hook already found safe (`cleared`) stays quiet at hard exit:
// no deny and no "not protected" notice, in either mode.
for (const mode of ['pass', 'block'])
  test(`WIN15 hard exit keeps a cleared prompt's quiet outcome (${mode})`, async () => {
    const project = tempProject({ env: false });
    const plugin = pluginWithBusyLoop(
      'user-prompt-submit',
      `globalThis.zerohHook.state.cleared = true;\n${HANG}`,
    );
    delayFallback(plugin);
    const result = await run(
      plugin,
      'user-prompt-submit',
      EVENTS['user-prompt-submit'],
      project,
      { ...FAST, ZEROH_UNCERTAIN: mode },
    );
    const diagnostics = `${hookChildDiagnostics(result)}; probes=${result.probeTrace}`;
    assert.match(result.probeTrace, /ZEROH_HARD_EXIT_FALLBACK/u, diagnostics);
    assert.ok(
      result.probes.some((probe) => probe.type === 'emergency-emission'),
      diagnostics,
    );
    const raw = JSON.stringify({
      session_id: 'watchdog',
      cwd: project.dir,
      ...EVENTS['user-prompt-submit'],
    });
    const expected = (mode === 'block' ? failClosedAnswer : passAnswer)(
      'user-prompt-submit',
      raw,
      { emitted: false, cleared: true, sideEffect: null },
      timeoutError(Number(FAST.ZEROH_HOOK_DEADLINE_MS)),
    );
    assert.equal(result.code, expected.code, diagnostics);
    assert.notEqual(result.code, 2, diagnostics);
    assert.equal(result.stdout, expected.stdout ?? '', diagnostics);
    assert.doesNotMatch(result.stdout, /not protected/u, diagnostics);
  });

for (const injectedWindows of [false, true])
  test(`WIN15 an unknown mode at hard exit uses the default pass notice (${injectedWindows ? 'injected Windows' : 'native platform'})`, async () => {
    const project = tempProject({ env: false });
    const plugin = pluginWithBusyLoop('pre-tool-use', HANG);
    delayFallback(plugin, { unknownMode: true });
    const result = await run(
      plugin,
      'pre-tool-use',
      EVENTS['pre-tool-use'],
      project,
      {
        ...BLOCK,
        ...(injectedWindows
          ? {
              ZEROH_WORKER_TEST_TRACE: path.join(project.dir, 'trace'),
              NODE_OPTIONS: [
                process.env.NODE_OPTIONS,
                '--import=' +
                  pathToFileURL(
                    path.join(
                      PLUGIN,
                      'test/tools/worker-child-process-preload.mjs',
                    ),
                  ).href,
              ]
                .filter(Boolean)
                .join(' '),
            }
          : {}),
      },
    );
    const diagnostics = `${hookChildDiagnostics(result)}; probes=${result.probeTrace}`;
    assert.match(result.probeTrace, /ZEROH_HARD_EXIT_FALLBACK/u, diagnostics);
    assert.ok(
      result.probes.some((probe) => probe.type === 'emergency-emission'),
      diagnostics,
    );
    assert.equal(result.code, 0, diagnostics);
    assert.equal(result.stdout.trim().split('\n').length, 1, diagnostics);
    assert.deepEqual(
      JSON.parse(result.stdout),
      {
        systemMessage:
          'ZeroH Disclosure: this command was not protected (timed out). Type /zeroh-disclosure:settings uncertain block to stop these instead.',
      },
      diagnostics,
    );
    assert.match(result.stderr, /this command was not protected/u, diagnostics);
  });

test('the deadline table matches hooks.json, two seconds under each timeout', async () => {
  const hooks = JSON.parse(
    readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'),
  ).hooks;
  for (const [event, entries] of Object.entries(hooks)) {
    const { timeout, command } = entries[0].hooks[0];
    const name = command.split(' ').at(-1);
    assert.equal(HOOK_TIMEOUTS[name], timeout, event);
    assert.equal(hookDeadlineMs(name, {}), (timeout - 2) * 1000);
  }
  assert.deepEqual(
    Object.keys(HOOK_TIMEOUTS).sort(),
    [
      ...new Set(
        Object.values(hooks).map((entries) =>
          entries[0].hooks[0].command.split(' ').at(-1),
        ),
      ),
    ].sort(),
  );
  // An override can only shorten the deadline.
  assert.equal(
    hookDeadlineMs('pre-tool-use', { ZEROH_HOOK_DEADLINE_MS: '1500' }),
    1500,
  );
  assert.equal(
    hookDeadlineMs('pre-tool-use', { ZEROH_HOOK_DEADLINE_MS: '600000' }),
    8000,
  );
});

test('block mode: a hook stuck in synchronous code fails closed at its deadline, for every hook', async () => {
  const p = tempProject();
  for (const name of Object.keys(EVENTS)) {
    const plugin = pluginWithBusyLoop(name, HANG);
    const r = await run(plugin, name, EVENTS[name], p, BLOCK);
    assert.equal(
      r.signal,
      null,
      `${name} was killed, not answered` + '; ' + hookChildDiagnostics(r),
    );
    assert.notEqual(
      r.watchdogMs,
      null,
      `${name} never reached the hanging hook` + '; ' + hookChildDiagnostics(r),
    );
    // Exclude child startup; allow the deadline plus the loader fallback budgets.
    assert.ok(
      r.watchdogMs < 4000,
      `${name} watchdog took ${r.watchdogMs.toFixed(0)} ms` +
        '; ' +
        hookChildDiagnostics(r),
    );
    assert.ok(
      !r.stdout.includes(FAKE_STRIPE),
      name + '; ' + hookChildDiagnostics(r),
    );
    if (['user-prompt-submit', 'pre-tool-use', 'post-tool-use'].includes(name))
      assert.ok(
        r.json,
        `${name}: missing watchdog answer; ${hookChildDiagnostics(r)}`,
      );
    if (name === 'user-prompt-submit') {
      assert.equal(r.code, 2, hookChildDiagnostics(r));
      assert.match(r.stderr, /timed out/u, hookChildDiagnostics(r));
      assert.equal(r.json?.decision, 'block', hookChildDiagnostics(r));
      assert.match(
        r.json?.reason,
        /ZeroH Disclosure: this prompt was stopped because it could not be protected \(timed out\)\./u,
        hookChildDiagnostics(r),
      );
    } else if (name === 'pre-tool-use') {
      assert.equal(r.code, 0, hookChildDiagnostics(r));
      assert.equal(
        r.json?.hookSpecificOutput?.permissionDecision,
        'deny',
        hookChildDiagnostics(r),
      );
      assert.match(
        r.json?.hookSpecificOutput?.permissionDecisionReason,
        /ZeroH Disclosure: this command was stopped because it could not be protected \(timed out\)\./u,
        hookChildDiagnostics(r),
      );
    } else if (name === 'post-tool-use') {
      assert.equal(r.code, 0, hookChildDiagnostics(r));
      assert.ok(
        r.json,
        `${name}: missing watchdog answer` + '; ' + hookChildDiagnostics(r),
      );
      const output = r.json?.hookSpecificOutput?.updatedToolOutput;
      assert.ok(output, hookChildDiagnostics(r));
      assert.equal(output.type, 'text', hookChildDiagnostics(r));
      assert.match(
        output.file.content,
        /this tool output was stopped because it could not be protected \(timed out\)/u,
        hookChildDiagnostics(r),
      );
    } else {
      assert.equal(r.code, 1, name + '; ' + hookChildDiagnostics(r));
      assert.match(
        r.stderr,
        /timed out/u,
        name + '; ' + hookChildDiagnostics(r),
      );
    }
  }
});

test('without an override the deadline is the hooks.json timeout minus 2 s', async () => {
  const p = tempProject();
  const plugin = pluginWithBusyLoop('message-display', HANG);
  const r = await run(plugin, 'message-display', EVENTS['message-display'], p);
  assert.equal(r.code, 1, hookChildDiagnostics(r));
  // The loader names the deadline it used: 5 s - 2 s. Wall time only bounds
  // it from below: process start-up on a Windows runner varied from 0.3 to
  // over 3 s, so an upper bound on it measured the runner, not the deadline.
  assert.match(r.stderr, /timed out \(over 3 s\)/u, hookChildDiagnostics(r));
  assert.ok(
    r.ms >= 2900,
    `${r.ms.toFixed(0)} ms` + '; ' + hookChildDiagnostics(r),
  );
});

// A MessageDisplay flush that already answered keeps its answer when its
// bookkeeping runs past the deadline: Claude Code shows a failed flush's
// original delta, with its tokens.
test('a MessageDisplay flush that answered before its deadline exits 0', async () => {
  const p = tempProject();
  const body = `globalThis.zerohHook.state.emitted = true;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: 'ZEROHFAKE shown' } }) + '\\n');
for (;;) {}
`;
  const plugin = pluginWithBusyLoop('message-display', body);
  for (const extra of [FAST, BLOCK]) {
    const r = await run(
      plugin,
      'message-display',
      EVENTS['message-display'],
      p,
      extra,
    );
    assert.equal(r.code, 0, r.stderr + '; ' + hookChildDiagnostics(r));
    assert.equal(
      r.json?.hookSpecificOutput?.displayContent,
      'ZEROHFAKE shown',
      hookChildDiagnostics(r),
    );
  }
});

test('block mode: a side effect in progress is reported as possibly half-done', async () => {
  const p = tempProject();
  const body = `import { markSideEffect } from '../lib/hook-io.js';
markSideEffect('turning the local proxy off');
for (;;) {}
`;
  const plugin = pluginWithBusyLoop('user-prompt-submit', body);
  const r = await run(
    plugin,
    'user-prompt-submit',
    { prompt: '/zeroh-disclosure:proxy off' },
    p,
    BLOCK,
  );
  assert.equal(r.code, 2, hookChildDiagnostics(r));
  assert.match(
    r.json?.reason,
    /turning the local proxy off/u,
    hookChildDiagnostics(r),
  );
  assert.match(r.json?.reason, /half-done/u, hookChildDiagnostics(r));
  assert.match(
    r.json?.reason,
    /\/zeroh-disclosure:doctor/u,
    hookChildDiagnostics(r),
  );
});

test('loader timeout during removal gives Claude Code plugin commands', async () => {
  const project = tempProject();
  const plugin = pluginWithBusyLoop(
    'user-prompt-submit',
    `import { markSideEffect } from '../lib/hook-io.js';
markSideEffect('running /zeroh-disclosure:uninstall --yes');
for (;;) {}
`,
  );
  const result = await run(
    plugin,
    'user-prompt-submit',
    { prompt: '/zeroh-disclosure:uninstall' },
    project,
    BLOCK,
  );
  assert.equal(result.code, 2, hookChildDiagnostics(result));
  assert.match(
    result.json.reason,
    /removal may be running in the background/u,
    hookChildDiagnostics(result),
  );
  assert.match(
    result.json.reason,
    /type \/zeroh-disclosure:uninstall again/u,
    hookChildDiagnostics(result),
  );
  assert.match(
    result.json.reason,
    /claude plugin uninstall zeroh-disclosure@zeroh/u,
    hookChildDiagnostics(result),
  );
  assert.doesNotMatch(
    result.json.reason,
    /zeroh-disclosure:doctor/u,
    hookChildDiagnostics(result),
  );
});

test('answers written before a hang are kept; exit codes come through the loader', async () => {
  const p = tempProject();
  const emitted = pluginWithBusyLoop(
    'pre-tool-use',
    `import { emit } from '../lib/hook-io.js';
emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'ok' } });
for (;;) {}
`,
  );
  const r = await run(
    emitted,
    'pre-tool-use',
    EVENTS['pre-tool-use'],
    p,
    BLOCK,
  );
  assert.equal(r.code, 0, hookChildDiagnostics(r));
  assert.equal(
    r.json?.hookSpecificOutput?.additionalContext,
    'ok',
    hookChildDiagnostics(r),
  );
  assert.equal(r.stdout.trim().split('\n').length, 1, hookChildDiagnostics(r));

  const stopped = pluginWith(
    'user-prompt-submit',
    `import { stopPrompt } from '../lib/hook-io.js';
stopPrompt('stopped for the test');
`,
  );
  const s = await run(stopped, 'user-prompt-submit', { prompt: 'x' }, p, FAST);
  assert.equal(s.code, 2, hookChildDiagnostics(s));
  assert.equal(s.json.reason, 'stopped for the test', hookChildDiagnostics(s));
  assert.match(s.stderr, /stopped for the test/u, hookChildDiagnostics(s));

  const exits = pluginWith(
    'stop',
    `process.stdout.write('line one\\n');
process.stderr.write('note\\n');
process.exit(0);
`,
  );
  const e = await run(exits, 'stop', {}, p, FAST);
  assert.equal(e.code, 0, hookChildDiagnostics(e));
  assert.equal(e.stdout, 'line one\n', hookChildDiagnostics(e));
  assert.equal(e.stderr, 'note\n', hookChildDiagnostics(e));
});

test('a hook that throws in the worker: denied in block mode, passed with a notice by default', async () => {
  const p = tempProject();
  const plugin = pluginWith(
    'pre-tool-use',
    `await Promise.resolve(); throw Object.assign(new Error('boom'), { code: 'EBOOM' });\n`,
  );
  const r = await run(plugin, 'pre-tool-use', EVENTS['pre-tool-use'], p, BLOCK);
  assert.equal(r.code, 0, hookChildDiagnostics(r));
  assert.ok(r.json, `missing watchdog answer; ${hookChildDiagnostics(r)}`);
  assert.equal(
    r.json?.hookSpecificOutput?.permissionDecision,
    'deny',
    hookChildDiagnostics(r),
  );
  const passed = await run(
    plugin,
    'pre-tool-use',
    EVENTS['pre-tool-use'],
    p,
    FAST,
  );
  assert.equal(passed.code, 0, hookChildDiagnostics(passed));
  assert.equal(
    passed.json.hookSpecificOutput,
    undefined,
    hookChildDiagnostics(passed),
  );
  assert.equal(
    passed.json.systemMessage,
    'ZeroH Disclosure: this command was not protected (check failed: EBOOM).',
    hookChildDiagnostics(passed),
  );
});

// A session with a current turn, so a timeout can be counted on it.
function withTurn(p) {
  // A real UserPromptSubmit protects the home before creating its ledger.
  // Do the same for a fixture that writes that ledger directly.
  prepareWindowsHome({ env: { ...process.env, ZEROH_HOME: p.home } });
  const dir = sessionDir(p.dir, 'watchdog', {
    ZEROH_HOME: p.home,
    HOME: p.home,
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ turnCount: 1 }));
  writeFileSync(path.join(dir, 'turn-1.json'), JSON.stringify({ turn: 1 }));
  return () =>
    JSON.parse(readFileSync(path.join(dir, 'turn-1.json'), 'utf8')).audit
      ?.unchecked;
}

const NOTICE_LINES = {
  'user-prompt-submit':
    'ZeroH Disclosure: this prompt was not protected (timed out).',
  'pre-tool-use':
    'ZeroH Disclosure: this command was not protected (timed out).',
  'post-tool-use':
    'ZeroH Disclosure: this tool output was not protected (timed out).',
};
const NOTICE_HINT =
  ' Type /zeroh-disclosure:settings uncertain block to stop these instead.';
const noticeOutput = (notice) =>
  notice === null ? '' : `${JSON.stringify({ systemMessage: notice })}\n`;

// Completed bookkeeping must return the expected history. Only actual budget
// expiry or emergency emission permits the exact unknown-history answer.
function assertTimedNotice(result, name, expectedNotice) {
  const diagnostics = hookChildDiagnostics(result);
  const wait = result.probes.find((probe) => probe.type === 'notice-wait');
  const emergency = result.probes.some(
    (probe) => probe.type === 'emergency-emission',
  );
  assert.equal(result.code, 0, diagnostics);
  assert.equal(result.signal, null, diagnostics);
  assert.equal(
    result.stderr,
    result.stdout ? `${JSON.parse(result.stdout).systemMessage}\n` : '',
    diagnostics,
  );
  assert.ok(wait || emergency, `missing notice trace; ${diagnostics}`);
  assert.ok(
    !result.probes.some((probe) => probe.type === 'bookkeeping-failure'),
    diagnostics,
  );
  if (wait) {
    assert.ok(['result', 'budget'].includes(wait.source), diagnostics);
    if (wait.source === 'result')
      assert.equal(wait.value, expectedNotice, diagnostics);
  }
  if (result.stdout === noticeOutput(expectedNotice)) return;
  assert.ok(wait?.source === 'budget' || emergency, diagnostics);
  assert.equal(
    result.stdout,
    noticeOutput(NOTICE_LINES[name] + NOTICE_HINT),
    diagnostics,
  );
  console.error(`[FIX-W proven fallback] ${diagnostics}`);
}

function injectedWindowsEnv(project) {
  return {
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS,
      '--import=' +
        pathToFileURL(
          path.join(PLUGIN, 'test/tools/worker-child-process-preload.mjs'),
        ).href,
    ]
      .filter(Boolean)
      .join(' '),
    ZEROH_WORKER_TEST_TRACE: path.join(project.dir, 'bookkeeping-trace'),
  };
}

// This drives the actual worker, without the loader's best-effort race. On
// Windows it uses the real private-home preflight and native worker paths.
async function completeBookkeeping(project, name) {
  const env = fixtureEnv(project);
  const protectedHome =
    process.platform === 'win32' ? prepareWindowsHome({ env }) : undefined;
  const event = { session_id: 'watchdog', cwd: project.dir, ...EVENTS[name] };
  const worker = new Worker(
    new URL('../../hooks/timeout-bookkeeping.js', import.meta.url),
    {
      env,
      workerData: {
        name,
        event,
        raw: JSON.stringify(event),
        count: true,
        ok: true,
        storagePreflight: process.platform === 'win32',
        protectedHome,
      },
    },
  );
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      let received = false;
      let notice;
      timer = setTimeout(
        () =>
          reject(
            new Error(
              'bookkeeping did not complete within the 15 s test safety timeout',
            ),
          ),
        15000,
      );
      worker.once('error', reject);
      worker.on('message', (value) => {
        if (value?.type === 'subprocess') return;
        if (received) {
          reject(new Error('bookkeeping posted more than one result'));
          return;
        }
        received = true;
        notice = value;
      });
      worker.once('exit', (code) => {
        if (code !== 0 || !received)
          reject(new Error(`bookkeeping exit=${code}; received=${received}`));
        else resolve(notice);
      });
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}

test('FIX-W real bookkeeping completion notices once per turn and counts every event', async () => {
  const project = tempProject({ env: false });
  const unchecked = withTurn(project);
  assert.equal(
    await completeBookkeeping(project, 'pre-tool-use'),
    NOTICE_LINES['pre-tool-use'] + NOTICE_HINT,
  );
  assert.equal(await completeBookkeeping(project, 'pre-tool-use'), null);
  assert.equal(await completeBookkeeping(project, 'post-tool-use'), null);
  assert.deepEqual(unchecked(), { 'watchdog-timeout': { Bash: 2, Read: 1 } });
  const dir = sessionDir(project.dir, 'watchdog', {
    ZEROH_HOME: project.home,
    HOME: project.home,
  });
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ turnCount: 2 }));
  writeFileSync(path.join(dir, 'turn-2.json'), JSON.stringify({ turn: 2 }));
  assert.equal(
    await completeBookkeeping(project, 'post-tool-use'),
    NOTICE_LINES['post-tool-use'],
  );
});

for (const injectedWindows of [false, true])
  test(`FIX-W loader completes real bookkeeping and counts every event (${injectedWindows ? 'injected Windows' : 'native platform'})`, async () => {
    const project = tempProject({ env: false });
    const unchecked = withTurn(project);
    const timeout =
      "throw Object.assign(new Error('ZEROHFAKE timeout'), { code: 'TIMEOUT' });";
    const plugin = pluginWith('pre-tool-use', timeout);
    writeFileSync(path.join(plugin, 'hooks/post-tool-use.js'), timeout);
    widenBookkeepingRace(plugin);
    const env = {
      ...FAST,
      ...(injectedWindows ? injectedWindowsEnv(project) : {}),
    };
    for (const [name, notice] of [
      ['pre-tool-use', NOTICE_LINES['pre-tool-use'] + NOTICE_HINT],
      ['pre-tool-use', null],
      ['post-tool-use', null],
    ]) {
      const result = await run(plugin, name, EVENTS[name], project, env);
      const diagnostics = hookChildDiagnostics(result);
      assert.deepEqual(
        result.probes,
        [{ type: 'notice-wait', source: 'result', value: notice }],
        diagnostics,
      );
      assert.equal(result.stdout, noticeOutput(notice), diagnostics);
      assert.equal(
        result.stderr,
        notice === null ? '' : `${notice}\n`,
        diagnostics,
      );
      assert.equal(result.code, 0, diagnostics);
      assert.equal(result.signal, null, diagnostics);
    }
    assert.deepEqual(unchecked(), { 'watchdog-timeout': { Bash: 2, Read: 1 } });
  });

for (const notice of [null, 'ZEROHFAKE already-settled notice', undefined])
  test(`FIX-W loader selects an already-settled ${String(notice)} notice`, async () => {
    const project = tempProject({ env: false });
    const plugin = pluginWith(
      'pre-tool-use',
      "throw Object.assign(new Error('ZEROHFAKE timeout'), { code: 'TIMEOUT' });",
    );
    const runner = path.join(plugin, 'hooks/run.js');
    writeFileSync(
      runner,
      replaceAnchored(
        readFileSync(runner, 'utf8'),
        'async function countTimeout() {',
        `async function countTimeout() { return ${JSON.stringify(notice)};`,
      ),
    );
    const result = await run(
      plugin,
      'pre-tool-use',
      EVENTS['pre-tool-use'],
      project,
      FAST,
    );
    const diagnostics = hookChildDiagnostics(result);
    assert.deepEqual(
      result.probes,
      [
        {
          type: 'notice-wait',
          source: 'result',
          value: notice === undefined ? 'undefined' : notice,
        },
      ],
      diagnostics,
    );
    assert.equal(
      result.stdout,
      noticeOutput(
        notice === undefined
          ? NOTICE_LINES['pre-tool-use'] + NOTICE_HINT
          : notice,
      ),
      diagnostics,
    );
    assert.equal(result.code, 0, diagnostics);
    assert.equal(result.signal, null, diagnostics);
    assert.equal(
      result.stderr,
      notice === null
        ? ''
        : `${notice === undefined ? NOTICE_LINES['pre-tool-use'] + NOTICE_HINT : notice}\n`,
      diagnostics,
    );
    if (notice === undefined) {
      // Identical fallback output cannot prove that a timed lookup expired.
      assert.throws(
        () => assertTimedNotice(result, 'pre-tool-use', null),
        /"source":"result"/u,
      );
      assert.throws(
        () =>
          assertTimedNotice({ ...result, probes: [] }, 'pre-tool-use', null),
        /missing notice trace/u,
      );
      assert.throws(
        () =>
          assertTimedNotice(
            {
              ...result,
              probes: [{ type: 'notice-wait', source: 'result', value: null }],
            },
            'pre-tool-use',
            null,
          ),
        /"source":"result"/u,
      );
    }
  });

test('FIX-W a gated Windows bookkeeping worker expires the notice budget and passes once', async () => {
  const project = tempProject({ env: false });
  withTurn(project);
  const plugin = pluginWithBusyLoop('pre-tool-use', HANG);
  const worker = path.join(plugin, 'hooks/timeout-bookkeeping.js');
  writeFileSync(
    worker,
    `setInterval(() => {}, 1000);\nawait new Promise(() => {});\n` +
      readFileSync(worker, 'utf8'),
  );
  const result = await run(
    plugin,
    'pre-tool-use',
    EVENTS['pre-tool-use'],
    project,
    { ...FAST, ...injectedWindowsEnv(project) },
  );
  const diagnostics = hookChildDiagnostics(result);
  assert.deepEqual(
    result.probes,
    [{ type: 'notice-wait', source: 'budget', value: 'undefined' }],
    diagnostics,
  );
  assertTimedNotice(result, 'pre-tool-use', null);
  assert.deepEqual(
    JSON.parse(result.stdout),
    { systemMessage: NOTICE_LINES['pre-tool-use'] + NOTICE_HINT },
    diagnostics,
  );
});

test('FIX-W worker failure is diagnosed separately and cannot satisfy successful bookkeeping', async () => {
  const project = tempProject({ env: false });
  const plugin = pluginWith(
    'pre-tool-use',
    "throw Object.assign(new Error('ZEROHFAKE timeout'), { code: 'TIMEOUT' });",
  );
  widenBookkeepingRace(plugin);
  writeFileSync(
    path.join(plugin, 'hooks/timeout-bookkeeping.js'),
    "throw new Error('ZEROHFAKE bookkeeping failure');\n",
  );
  const result = await run(
    plugin,
    'pre-tool-use',
    EVENTS['pre-tool-use'],
    project,
    { ...FAST, ...injectedWindowsEnv(project) },
  );
  const diagnostics = hookChildDiagnostics(result);
  assert.deepEqual(
    result.probes,
    [
      { type: 'bookkeeping-failure', failure: 'worker-error' },
      { type: 'notice-wait', source: 'failure', value: 'undefined' },
    ],
    diagnostics,
  );
  assert.equal(
    result.stdout,
    noticeOutput(NOTICE_LINES['pre-tool-use'] + NOTICE_HINT),
    diagnostics,
  );
  assert.equal(result.code, 0, diagnostics);
  assert.equal(result.signal, null, diagnostics);
  assert.equal(
    result.stderr,
    NOTICE_LINES['pre-tool-use'] + NOTICE_HINT + '\n',
    diagnostics,
  );
  assert.throws(
    () => assertTimedNotice(result, 'pre-tool-use', null),
    /bookkeeping-failure/u,
  );
  assert.match(diagnostics, /worker-error/u);
  assert.doesNotMatch(diagnostics, /"source":"budget"/u);
});

test('emergency pass text never reads history: always the notice with the first-notice hint', async (t) => {
  for (const history of ['first', 'hint-shown', 'noticed']) {
    await t.test(history, async () => {
      for (const name of [
        'user-prompt-submit',
        'pre-tool-use',
        'post-tool-use',
      ]) {
        const results = [];
        for (const emergency of [false, true]) {
          const project = tempProject({ env: false });
          withTurn(project);
          const dir = sessionDir(project.dir, 'watchdog', {
            ...process.env,
            ZEROH_HOME: project.home,
          });
          if (history !== 'first')
            writeFileSync(path.join(dir, 'unchecked-hint-uncertain'), '');
          if (history === 'noticed')
            writeFileSync(
              path.join(dir, 'turn-1.json'),
              JSON.stringify({
                turn: 1,
                audit: { unchecked_noticed: ['watchdog-timeout'] },
              }),
            );
          const plugin = pluginWithBusyLoop(name, HANG);
          if (emergency) delayFallback(plugin);
          const result = await run(plugin, name, EVENTS[name], project, FAST);
          const diagnostics = hookChildDiagnostics(result);
          assert.equal(result.code, 0, diagnostics);
          assert.equal(result.signal, null, diagnostics);
          if (emergency) {
            assert.match(
              result.probeTrace,
              /ZEROH_HARD_EXIT_FALLBACK/u,
              diagnostics,
            );
            assert.ok(
              result.probes.some(
                (probe) => probe.type === 'emergency-emission',
              ),
              diagnostics,
            );
          }
          // Parse the entire stream: a second answer must fail this check.
          if (emergency) {
            // The emergency answer reads no history on the loader thread
            // (Astra A1): always the notice with the hint. A duplicate hint or
            // notice beats a missing one (WIN16 review P1).
            assert.equal(
              result.stdout,
              noticeOutput(NOTICE_LINES[name] + NOTICE_HINT),
              diagnostics,
            );
          } else {
            assertTimedNotice(
              result,
              name,
              history === 'noticed'
                ? null
                : NOTICE_LINES[name] + (history === 'first' ? NOTICE_HINT : ''),
            );
          }
          results.push(result);
        }
        if (history === 'first') {
          assert.equal(results[1].stdout, results[0].stdout, name);
          assert.equal(results[1].stderr, results[0].stderr, name);
        }
      }
    });
  }
});

test('pass mode (the default): a stuck hook lets the event through and selects the once-per-turn notice or proven fallback', async () => {
  const lines = NOTICE_LINES;
  // Each guarding hook on a turn of its own shows its line.
  for (const name of Object.keys(EVENTS)) {
    const p = tempProject();
    withTurn(p);
    const plugin = pluginWithBusyLoop(name, HANG);
    const r = await run(plugin, name, EVENTS[name], p, FAST);
    assert.equal(r.signal, null, name + '; ' + hookChildDiagnostics(r));
    assert.notEqual(
      r.watchdogMs,
      null,
      `${name} never reached the hanging hook` + '; ' + hookChildDiagnostics(r),
    );
    // Exclude child startup; allow the deadline plus the loader fallback budgets.
    assert.ok(
      r.watchdogMs < 4000,
      `${name} watchdog took ${r.watchdogMs.toFixed(0)} ms` +
        '; ' +
        hookChildDiagnostics(r),
    );
    if (lines[name]) {
      assert.equal(r.code, 0, name + '; ' + hookChildDiagnostics(r));
      assert.ok(
        r.json,
        `${name}: missing watchdog answer` + '; ' + hookChildDiagnostics(r),
      );
      assert.equal(
        r.json?.hookSpecificOutput,
        undefined,
        name + '; ' + hookChildDiagnostics(r),
      );
      assert.equal(
        r.json?.decision,
        undefined,
        name + '; ' + hookChildDiagnostics(r),
      );
      // The session's first notice says how to tighten.
      assert.equal(
        r.json?.systemMessage,
        `${lines[name]} Type /zeroh-disclosure:settings uncertain block to stop these instead.`,
        hookChildDiagnostics(r),
      );
    } else {
      // The hooks that guard nothing: a non-blocking error, not counted.
      assert.equal(r.code, 1, name + '; ' + hookChildDiagnostics(r));
      assert.match(
        r.stderr,
        /timed out/u,
        name + '; ' + hookChildDiagnostics(r),
      );
    }
  }
  // Real timed selection: persistence may not finish within the budget.
  // The direct-worker test above proves the exact per-turn counts.
  const p = tempProject();
  withTurn(p);
  const pre = pluginWithBusyLoop('pre-tool-use', HANG);
  const post = pluginWithBusyLoop('post-tool-use', HANG);
  const first = await run(pre, 'pre-tool-use', EVENTS['pre-tool-use'], p, FAST);
  assertTimedNotice(
    first,
    'pre-tool-use',
    NOTICE_LINES['pre-tool-use'] + NOTICE_HINT,
  );
  // If the first run recovered before persistence, establish the known
  // history explicitly so the next runs test duplicate selection, not a
  // second assumption that best-effort bookkeeping has already completed.
  if (
    !first.probes.some(
      (probe) => probe.type === 'notice-wait' && probe.source === 'result',
    )
  ) {
    const dir = sessionDir(p.dir, 'watchdog', {
      ZEROH_HOME: p.home,
      HOME: p.home,
    });
    writeFileSync(
      path.join(dir, 'turn-1.json'),
      JSON.stringify({
        turn: 1,
        audit: { unchecked_noticed: ['watchdog-timeout'] },
      }),
    );
    writeFileSync(path.join(dir, 'unchecked-hint-uncertain'), '');
  }
  const second = await run(
    pre,
    'pre-tool-use',
    EVENTS['pre-tool-use'],
    p,
    FAST,
  );
  assertTimedNotice(second, 'pre-tool-use', null);
  const third = await run(
    post,
    'post-tool-use',
    EVENTS['post-tool-use'],
    p,
    FAST,
  );
  assertTimedNotice(third, 'post-tool-use', null);
});

test('pass mode: a management change cut short is a notice, not a stopped prompt', async () => {
  const p = tempProject();
  const plugin = pluginWithBusyLoop(
    'user-prompt-submit',
    `import { markSideEffect } from '../lib/hook-io.js';
markSideEffect('turning the local proxy off');
for (;;) {}
`,
  );
  // The worker must reach markSideEffect before the watchdog fires; 1.5 s was
  // too tight for a loaded runner (staged release run, 2026-10-08).
  const r = await run(
    plugin,
    'user-prompt-submit',
    { prompt: '/zeroh-disclosure:proxy off' },
    p,
    { ZEROH_HOOK_DEADLINE_MS: '5000' },
  );
  assert.equal(r.code, 0, hookChildDiagnostics(r));
  assert.match(
    r.json?.systemMessage,
    /turning the local proxy off/u,
    hookChildDiagnostics(r),
  );
  assert.match(r.json?.systemMessage, /half-done/u, hookChildDiagnostics(r));
  assert.match(
    r.json?.systemMessage,
    /\/zeroh-disclosure:doctor/u,
    hookChildDiagnostics(r),
  );
});

test('a broken install answers pass even when block is asked for (D-10)', async () => {
  const p = tempProject();
  const plugin = pluginWith('pre-tool-use', 'export const = ;\n');
  writeFileSync(
    path.join(plugin, 'packages', 'zeroh-disclosure-core', 'config.js'),
    'export const = ;\n',
  );
  const r = await run(plugin, 'pre-tool-use', EVENTS['pre-tool-use'], p, BLOCK);
  assert.equal(r.code, 0, hookChildDiagnostics(r));
  assert.equal(r.json?.hookSpecificOutput, undefined, hookChildDiagnostics(r));
  assert.match(
    r.json?.systemMessage,
    /^ZeroH Disclosure: this command was not protected \(check failed/u,
    hookChildDiagnostics(r),
  );
});

test('a repository can make the mode block through .zeroh.env', async () => {
  const p = tempProject();
  writeFileSync(path.join(p.dir, '.zeroh.env'), 'ZEROH_UNCERTAIN=block\n');
  const plugin = pluginWithBusyLoop('pre-tool-use', HANG);
  const r = await run(plugin, 'pre-tool-use', EVENTS['pre-tool-use'], p, FAST);
  assert.ok(r.json, `missing watchdog answer; ${hookChildDiagnostics(r)}`);
  assert.equal(
    r.json?.hookSpecificOutput?.permissionDecision,
    'deny',
    hookChildDiagnostics(r),
  );
});

test('after uninstall a stuck hook never starts', async () => {
  const p = tempProject();
  const env = { ZEROH_HOME: p.home, HOME: p.home };
  const owner = markUninstallPending(env);
  assert.equal(markUninstalled(env, owner.nonce), true);
  const plugin = pluginWith('pre-tool-use', HANG);
  const r = await run(plugin, 'pre-tool-use', EVENTS['pre-tool-use'], p, FAST);
  assert.equal(r.code, 0, hookChildDiagnostics(r));
  assert.equal(r.stdout, '', hookChildDiagnostics(r));
  assert.ok(
    r.ms < 1400,
    `${r.ms.toFixed(0)} ms` + '; ' + hookChildDiagnostics(r),
  );
});

// Instrument the join request, not completion of a scheduling-dependent
// 50 ms timer inside the 100 ms join budget. Only this child is preloaded.
for (const injectedWindows of [false, true])
  for (const [label, delay, stalledStdout] of [
    ['finish requests termination within the bound', 50, false],
    ['hard watchdog joins with stalled stdout', 50, true],
    ['hard bound survives a termination that never settles', 5000, true],
  ])
    test(`worker teardown: ${label}${injectedWindows ? ' (injected Windows)' : ''}`, async () => {
      const project = tempProject();
      const plugin = pluginWith(
        'pre-tool-use',
        `
process.stderr.write('ZEROH_WATCHDOG_READY\\n');
import { emit } from '../lib/hook-io.js';
emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'ZEROHFAKE answer' } });
${stalledStdout ? 'for (;;) {}' : ''}
`,
      );
      if (stalledStdout) busyLoopPlugins.add(plugin);
      const preload = path.join(plugin, 'termination-probe.mjs');
      writeFileSync(
        preload,
        `
import { Worker, isMainThread } from 'node:worker_threads';
import { writeSync } from 'node:fs';
if (isMainThread) {
  const original = Worker.prototype.terminate;
  Worker.prototype.terminate = function () {
    writeSync(2, 'ZEROH_TERMINATION_ATTEMPTED\\n');
    return original.call(this).then(() => new Promise(resolve => {
      setTimeout(() => {
        writeSync(2, 'ZEROH_TERMINATION_COMPLETE\\n');
        resolve();
      }, ${delay});
    }));
  };
  ${
    stalledStdout
      ? `
  const schedule = globalThis.setTimeout;
  let started, deadlineMs;
  globalThis.setTimeout = function (callback, ms, ...args) {
    if (started === undefined) {
      started = performance.now();
      deadlineMs = ms;
      writeSync(2, 'ZEROH_TIMER_DEADLINE=' + ms + '\\n');
    }
    if (ms === deadlineMs + 900 || ms === deadlineMs + 1000) {
      const hardCallback = callback;
      callback = (...values) => {
        writeSync(2, ms === deadlineMs + 900 ? 'ZEROH_HARD_TIMER\\n' : 'ZEROH_HARD_EXIT_TIMER\\n');
        hardCallback(...values);
      };
    }
    return schedule(callback, ms, ...args);
  };
  const exit = process.exit;
  process.exit = function (code) {
    writeSync(2, 'ZEROH_EXIT_MS=' + (performance.now() - started) + '\\n');
    exit.call(this, code);
  };
  const write = process.stdout.write;
  process.stdout.write = function (chunk) { return write.call(this, chunk); };
  `
      : ''
  }
}
`,
      );
      const result = await run(
        plugin,
        'pre-tool-use',
        EVENTS['pre-tool-use'],
        project,
        {
          ...FAST,
          ...(injectedWindows
            ? {
                ZEROH_WORKER_TEST_TRACE: path.join(
                  project.dir,
                  'teardown-trace',
                ),
              }
            : {}),
          NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            ...(injectedWindows
              ? [
                  '--import=' +
                    pathToFileURL(
                      path.join(
                        PLUGIN,
                        'test/tools/worker-child-process-preload.mjs',
                      ),
                    ).href,
                ]
              : []),
            `--import=${pathToFileURL(preload).href}`,
          ]
            .filter(Boolean)
            .join(' '),
        },
      );
      assert.equal(
        result.code,
        0,
        result.stderr + '; ' + hookChildDiagnostics(result),
      );
      assert.equal(
        result.json?.hookSpecificOutput?.additionalContext,
        'ZEROHFAKE answer',
        hookChildDiagnostics(result),
      );
      assert.equal(
        result.stdout.trim().split('\n').length,
        1,
        'one answer only' + '; ' + hookChildDiagnostics(result),
      );
      assert.notEqual(
        result.watchdogMs,
        null,
        'the worker reached the answer' + '; ' + hookChildDiagnostics(result),
      );
      assert.ok(
        result.watchdogMs < 2800,
        `hard exit bound after worker startup: ${result.watchdogMs} ms` +
          '; ' +
          hookChildDiagnostics(result),
      );
      assert.notEqual(
        result.outputMs,
        null,
        'the answer reached stdout' + '; ' + hookChildDiagnostics(result),
      );
      assert.ok(
        result.outputMs < 1000,
        'the answer does not wait for teardown' +
          '; ' +
          hookChildDiagnostics(result),
      );
      assert.match(
        result.stderr,
        /ZEROH_TERMINATION_ATTEMPTED/u,
        hookChildDiagnostics(result),
      );
      if (stalledStdout) {
        assert.match(
          result.stderr,
          /ZEROH_HARD_TIMER/u,
          'the hard timer ran' + '; ' + hookChildDiagnostics(result),
        );
        assert.match(
          result.stderr,
          /ZEROH_HARD_EXIT_TIMER/u,
          'exit came from the +1000 timer' +
            '; ' +
            hookChildDiagnostics(result),
        );
        const exitMs = Number(
          /ZEROH_EXIT_MS=([\d.]+)/u.exec(result.stderr)?.[1],
        );
        const deadlineMs = Number(
          /ZEROH_TIMER_DEADLINE=([\d.]+)/u.exec(result.stderr)?.[1],
        );
        assert.ok(
          exitMs >= deadlineMs + 980,
          `the +1000 grace was retained: ${exitMs} ms; ${hookChildDiagnostics(result)}`,
        );
        assert.ok(
          exitMs < 2800,
          `exit stayed within the hard bound: ${exitMs} ms; ${hookChildDiagnostics(result)}`,
        );
      }
      if (delay === 5000)
        assert.doesNotMatch(
          result.stderr,
          /ZEROH_TERMINATION_COMPLETE/u,
          'a hung join cannot extend the hard bound' +
            '; ' +
            hookChildDiagnostics(result),
        );
    });
