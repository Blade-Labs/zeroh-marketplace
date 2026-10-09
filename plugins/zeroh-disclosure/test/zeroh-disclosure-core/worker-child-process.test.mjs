// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { importsChildProcess } from '../tools/js-tokens.mjs';
import { FAKE_STRIPE, PLUGIN, stateDirOf, tempProject } from '../helpers.mjs';

import { createServiceManager } from '../../packages/local-proxy/service-manager.js';
import { proxyPaths } from '../../packages/local-proxy/proxy-state.js';
import { shutdownDaemon } from '../../packages/local-proxy/manager/probe.js';
import { stopDefaultProxy } from '../../packages/local-proxy/proxy-manager.js';

const preload = pathToFileURL(
  path.join(PLUGIN, 'test/tools/worker-child-process-preload.mjs'),
).href;
const traceOf = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
function environment(project, extra = {}) {
  return {
    ...process.env,
    HOME: project.home,
    USERPROFILE: project.home,
    ZEROH_HOME: project.home,
    ZEROH_PROXY: 'off',
    ZEROH_UNCERTAIN: 'block',
    ZEROH_WORKER_TEST_TRACE: path.join(project.dir, 'worker-trace.jsonl'),
    ...extra,
  };
}

test('real Windows hook and bookkeeping entries cannot call synchronous Node subprocess APIs', () => {
  for (const [name, event] of [
    ['pre-tool-use', { tool_name: 'Read', tool_input: { file_path: '.env' } }],
    [
      'post-tool-use',
      {
        tool_name: 'Read',
        tool_input: { file_path: 'fake.txt' },
        tool_response: `key=${FAKE_STRIPE}`,
      },
    ],
  ]) {
    const project = tempProject();
    const env = environment(project);
    const result = spawnSync(
      process.execPath,
      ['--import', preload, path.join(PLUGIN, 'hooks/run.js'), name],
      {
        env,
        cwd: project.dir,
        input: JSON.stringify({
          cwd: project.dir,
          session_id: 'ZEROHFAKE-worker',
          ...event,
        }),
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes(FAKE_STRIPE), result.stdout);
    const traces = traceOf(env.ZEROH_WORKER_TEST_TRACE);
    assert.ok(traces.some((row) => row.action === 'sync-child'));
    assert.ok(!traces.some((row) => row.action === 'spawn-with-worker'));
    const firstWorker = traces.findIndex(
      (row) => row.action === 'worker-entry',
    );
    const restores = traces.filter(
      (row) => row.action === 'sync-child' && row.args?.includes('/restore'),
    );
    assert.equal(restores.length, 1);
    assert.ok(traces.indexOf(restores[0]) < firstWorker);
    assert.ok(
      traces.every(
        (row) => row.action === 'worker-entry' || row.threadId === 0,
      ),
      JSON.stringify(traces),
    );
    assert.ok(existsSync(path.join(project.home, '.acl-protected')));
  }
});

// Only the adapter may load Node's subprocess module. It gates all hook
// calls through IPC; CLI/statusline modules also use it and need no exemption.
const subprocessExemptions = new Map([
  [
    path.join(PLUGIN, 'packages/zeroh-disclosure-core/child-process.js'),
    'Owns pre-worker preflight/host creation, IPC and the explicit CLI heartbeat service.',
  ],
]);
function subprocessOffenders(directory) {
  const offenders = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (
        /\.(?:js|mjs|cjs)$/u.test(entry.name) &&
        !subprocessExemptions.has(file)
      ) {
        const source = readFileSync(file, 'utf8');
        const forbidden = importsChildProcess(source);
        if (forbidden) offenders.push(file);
      }
    }
  }
  walk(directory);
  return offenders;
}

test('worker-reachable modules use the worker-safe subprocess adapter', () => {
  assert.deepEqual(
    ['packages', 'lib', 'hooks'].flatMap((dir) =>
      subprocessOffenders(path.join(PLUGIN, dir)),
    ),
    [],
  );
});

test('the import guard catches every child_process spelling and only exempts the exact adapter', () => {
  const project = tempProject();
  const fixtures = [
    ['default.js', "import cp from 'node:child_process';"],
    ['namespace.mjs', "import * as cp from 'child_process';"],
    ['require.cjs', "const cp = require('child_process');"],
    ['optional.cjs', "const cp = require?.('child_process');"],
    ['parenthesized.mjs', "import((('child_process')));"],
    ['unicode.js', "const π = 4; π / 2; import('child_process');"],
    ['property.js', "a.return / 2; import('child_process');"],
    ['require-node.js', "const cp = require('node:child_process');"],
    ['dynamic.mjs', "const cp = await import('child_process');"],
    ['dynamic-node.js', "import('node:child_process').then(use);"],
    [
      'interpolating.mjs',
      '`first ${123} then ${await import("node:child_process")}`',
    ],
    [
      'regex.mjs',
      `const pattern = /['"\\x60]/; import { spawnSync } from 'node:child_process';`,
    ],
    ['dynamic-template.mjs', 'import(`node:child_process`)'],
    ['template.mjs', '`safe ${await import("node:child_process")}`'],
    ['child-process.js', "import { spawnSync } from 'node:child_process';"],
    ['named.js', "import { execFileSync as run } from 'child_process';"],
    ['mixed.js', "import cp, { spawn } from 'node:child_process';"],
    ['async.js', "import { spawn, execFile } from 'node:child_process';"],
    [
      'alias.js',
      "import { createRequire as make } from 'node:module'; const load = make(import.meta.url); load('node:child_process');",
    ],
    ['nested.js', 'createRequire(import.meta.url)(`child_process`);'],
    ['export.js', "export { spawn } from 'node:child_process';"],
  ];
  for (const [name, source] of fixtures)
    writeFileSync(path.join(project.dir, name), source);
  assert.deepEqual(
    subprocessOffenders(project.dir).sort(),
    fixtures.map(([name]) => path.join(project.dir, name)).sort(),
  );
});

test('Windows ACL subprocess waits leave the real loader watchdog free to withhold output', () => {
  const project = tempProject();
  const env = environment(project, {
    ZEROH_WORKER_TEST_ACL_FAILURE: 'hang',
    ZEROH_HOOK_DEADLINE_MS: '1000',
  });
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    ['--import', preload, path.join(PLUGIN, 'hooks/run.js'), 'post-tool-use'],
    {
      env,
      cwd: project.dir,
      input: JSON.stringify({
        cwd: project.dir,
        session_id: 'ZEROHFAKE-worker',
        tool_name: 'Read',
        tool_input: { file_path: 'fake.txt' },
        tool_response: `key=${FAKE_STRIPE}`,
      }),
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(performance.now() - started < 5000);
  const answer = JSON.parse(result.stdout);
  assert.ok(answer.hookSpecificOutput.updatedToolOutput);
  assert.ok(!result.stdout.includes(FAKE_STRIPE));
  const traces = traceOf(env.ZEROH_WORKER_TEST_TRACE);
  assert.ok(traces.some((row) => row.action === 'kill-child'));
  assert.ok(traces.some((row) => row.action === 'worker-entry'));
  assert.ok(!traces.some((row) => row.action === 'spawn-with-worker'));
  assert.ok(
    traces.every((row) => row.action === 'worker-entry' || row.threadId === 0),
    JSON.stringify(traces),
  );
});

test('missing and malformed adapters retain the loader recovery notice', () => {
  for (const failure of ['missing', 'malformed']) {
    const project = tempProject();
    const broken = path.join(project.dir, 'broken');
    mkdirSync(path.join(broken, 'hooks'), { recursive: true });
    mkdirSync(path.join(broken, 'packages/zeroh-disclosure-core'), {
      recursive: true,
    });
    for (const name of ['run.js', 'fail-closed.js', 'worker.js'])
      cpSync(
        path.join(PLUGIN, 'hooks', name),
        path.join(broken, 'hooks', name),
      );
    cpSync(
      path.join(PLUGIN, 'package.json'),
      path.join(broken, 'package.json'),
    );
    if (failure === 'malformed')
      writeFileSync(
        path.join(broken, 'packages/zeroh-disclosure-core/child-process.js'),
        'export const = ;',
      );
    // readMode deliberately also cannot load: its documented default is pass.
    const result = spawnSync(
      process.execPath,
      ['--import', preload, path.join(broken, 'hooks/run.js'), 'post-tool-use'],
      {
        env: environment(project),
        cwd: project.dir,
        encoding: 'utf8',
        timeout: 5000,
        input: JSON.stringify({
          tool_name: 'Read',
          tool_response: FAKE_STRIPE,
        }),
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(JSON.parse(result.stdout).systemMessage, /not protected/u);
  }
});

test('SessionStart queries and creates its Windows login item asynchronously, including refusal', async () => {
  for (const failure of ['no', 'yes']) {
    const project = tempProject();
    const env = environment(project, {
      ZEROH_PROXY: 'on',
      ZEROH_SERVICE_MANAGER_DIR: '',
      USERNAME: 'ZEROHFAKE',
      ZEROH_WORKER_TEST_TASK_FAILURE: failure,
    });
    const paths = proxyPaths(env);
    const manager = createServiceManager({
      env,
      platform: 'win32',
      executeCommands: false,
    });
    manager.register({ runtime: paths.runtime, config: paths.config });
    try {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          preload,
          path.join(PLUGIN, 'hooks/run.js'),
          'session-start',
        ],
        {
          env,
          cwd: project.dir,
          encoding: 'utf8',
          timeout: 25000,
          input: JSON.stringify({
            cwd: project.dir,
            session_id: 'ZEROHFAKE-start',
            source: 'startup',
          }),
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        JSON.parse(result.stdout).hookSpecificOutput.hookEventName,
        'SessionStart',
        result.stdout,
      );
      const tasks = traceOf(env.ZEROH_WORKER_TEST_TRACE).filter((row) =>
        /schtasks\.exe$/iu.test(row.file || ''),
      );
      assert.ok(
        tasks.some((row) => row.args.includes('/Query')),
        JSON.stringify(tasks),
      );
      assert.ok(
        tasks.some((row) => row.args.includes('/Create')),
        JSON.stringify(tasks),
      );
      assert.ok(
        tasks.every(
          (row) =>
            row.action === 'async-child' &&
            row.threadId === 0 &&
            row.liveWorkers === 0,
        ),
      );
      const daemon = traceOf(env.ZEROH_WORKER_TEST_TRACE).find(
        (row) =>
          row.action === 'native-child' &&
          row.args?.some((arg) => String(arg).endsWith('proxy-daemon.mjs')),
      );
      assert.ok(daemon);
      assert.equal(
        daemon.cwd,
        env.SystemRoot || env.SYSTEMROOT || project.home,
      );
      assert.equal(existsSync(manager.paths.task), failure === 'no');
      const config = JSON.parse(readFileSync(paths.config, 'utf8'));
      assert.equal(Boolean(config.loginItemRefused), failure === 'yes');
      if (failure === 'yes')
        assert.match(
          JSON.parse(result.stdout).systemMessage,
          /could not register the login item.*session only/su,
        );
      assert.ok(
        !traceOf(env.ZEROH_WORKER_TEST_TRACE).some(
          (row) => row.action === 'forbidden-sync',
        ),
      );
    } finally {
      const config = JSON.parse(readFileSync(paths.config, 'utf8'));
      await stopDefaultProxy({ env, serviceManager: manager });
      // SessionStart has not switched this running Claude session to the proxy.
      // Stop the test daemon even when it still has a live route.
      await shutdownDaemon(config.port, config.controlToken);
    }
  }
});

test('removal heartbeat renews without its busy parent after marker deletion and null identity', () => {
  const project = tempProject();
  const env = environment(project, {
    ZEROH_WORKER_TEST_MAIN_ACL: 'yes',
    ZEROH_WORKER_TEST_REMOVE_MARKER: 'yes',
  });
  const removal = pathToFileURL(
    path.join(
      PLUGIN,
      'packages/zeroh-disclosure-core/user-authority/removal.js',
    ),
  ).href;
  const marker = pathToFileURL(
    path.join(PLUGIN, 'packages/zeroh-disclosure-core/uninstall-marker.js'),
  ).href;
  const script = `
    import { readFileSync } from 'node:fs';
    import { markUninstallPending, uninstallOwner } from ${JSON.stringify(marker)};
    import { prepareWindowsHome } from ${JSON.stringify(pathToFileURL(path.join(PLUGIN, 'packages/zeroh-disclosure-core/private-fs.js')).href)};
    prepareWindowsHome();
    import { startRemovalHeartbeat, stopRemovalHeartbeat } from ${JSON.stringify(removal)};
    const owner = uninstallOwner();
    if (owner.process_start !== null) throw new Error('expected unavailable identity');
    markUninstallPending(process.env, owner);
    process.env.ZEROH_REMOVAL_OWNER = owner.nonce;
    process.env.ZEROH_REMOVAL_LOCK = 'ZEROHFAKE-lock';
    startRemovalHeartbeat(process.env, { intervalMs: 20 });
    // No parent event-loop or subprocess service can run during this wait.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    const current = JSON.parse(readFileSync(process.env.ZEROH_HOME + '/uninstalled', 'utf8'));
    stopRemovalHeartbeat();
    if (!current.heartbeat_at) throw new Error('heartbeat never renewed');
    console.log('renewed');
  `;
  const scriptPath = path.join(project.dir, 'heartbeat-test.mjs');
  writeFileSync(scriptPath, script);
  const result = spawnSync(
    process.execPath,
    ['--import', preload, scriptPath],
    { env, encoding: 'utf8', timeout: 7000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'renewed');
  const heartbeatTrace = traceOf(env.ZEROH_WORKER_TEST_TRACE);
  assert.ok(
    !heartbeatTrace.some(
      (row) =>
        row.action === 'forbidden-sync' || row.action === 'spawn-with-worker',
    ),
  );
  assert.ok(
    heartbeatTrace
      .filter((row) => row.action === 'sync-child')
      .every((row) => row.liveWorkers === 0),
  );
  assert.equal(existsSync(path.join(project.home, '.acl-protected')), false);
});

const storageNotice =
  'ZeroH could not confirm its storage folder permissions on Windows (known limitation); private storage and masking continue as in 1.0.';
test('WIN11 the storage notice appears once across SessionStart startup, compact and resume', () => {
  const project = tempProject();
  const env = environment(project, { ZEROH_WORKER_TEST_ACL_FAILURE: 'yes' });
  delete env.ZEROH_UNCERTAIN;
  for (const source of ['startup', 'compact', 'resume']) {
    const result = spawnSync(
      process.execPath,
      ['--import', preload, path.join(PLUGIN, 'hooks/run.js'), 'session-start'],
      {
        env,
        cwd: project.dir,
        encoding: 'utf8',
        timeout: 20000,
        input: JSON.stringify({
          cwd: project.dir,
          session_id: 'ZEROHFAKE-once',
          source,
        }),
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout.split(storageNotice).length - 1,
      source === 'startup' ? 1 : 0,
    );
  }
  // Notice history is best effort; a corrupt marker must not fail the hook.
  const marker = path.join(
    stateDirOf(project),
    'sessions',
    'ZEROHFAKE-once',
    'storage-protection-notice.json',
  );
  writeFileSync(marker, '{');
  for (const expectedCount of [1, 0]) {
    const result = spawnSync(
      process.execPath,
      ['--import', preload, path.join(PLUGIN, 'hooks/run.js'), 'session-start'],
      {
        env,
        cwd: project.dir,
        encoding: 'utf8',
        timeout: 20000,
        input: JSON.stringify({
          cwd: project.dir,
          session_id: 'ZEROHFAKE-once',
          source: 'resume',
        }),
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.split(storageNotice).length - 1, expectedCount);
  }
});
test('WIN12 storage notice preserves state advanced after SessionStart loaded it', () => {
  const project = tempProject();
  const plugin = path.join(project.dir, 'plugin');
  cpSync(PLUGIN, plugin, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules`),
  });
  const hook = path.join(plugin, 'hooks/session-start.js');
  const source = readFileSync(hook, 'utf8');
  assert.ok(source.includes('const visibleNotices ='));
  // Simulate another hook advancing persistent state after this hook's load.
  // Record exact bytes so notice bookkeeping cannot overwrite any field.
  writeFileSync(
    hook,
    source.replace(
      'const visibleNotices =',
      `
    const fs = await import('node:fs');
    const current = JSON.parse(fs.readFileSync(session.statePath, 'utf8'));
    current.turnCount = 71;
    current.win12ConcurrentUpdate = 'ZEROHFAKE-newer-state';
    await writeLocalJson(session.statePath, current);
    fs.writeFileSync(process.env.ZEROH_WIN12_STATE_BEFORE, fs.readFileSync(session.statePath));
    fs.writeFileSync(process.env.ZEROH_WIN12_STATE_PATH, session.statePath);
    const visibleNotices =`,
    ),
  );
  const before = path.join(project.dir, 'before-state.json');
  const stateLocation = path.join(project.dir, 'state-path');
  const result = spawnSync(
    process.execPath,
    ['--import', preload, path.join(plugin, 'hooks/run.js'), 'session-start'],
    {
      env: environment(project, {
        ZEROH_WORKER_TEST_ACL_FAILURE: 'yes',
        ZEROH_WIN12_STATE_BEFORE: before,
        ZEROH_WIN12_STATE_PATH: stateLocation,
      }),
      cwd: project.dir,
      input: JSON.stringify({
        cwd: project.dir,
        session_id: 'ZEROHFAKE-win12-state',
        source: 'startup',
      }),
      encoding: 'utf8',
      timeout: 20000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /could not confirm its storage folder permissions/u,
  );
  const statePath = readFileSync(stateLocation, 'utf8');
  assert.equal(readFileSync(statePath, 'utf8'), readFileSync(before, 'utf8'));
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        path.join(path.dirname(statePath), 'storage-protection-notice.json'),
        'utf8',
      ),
    ),
    { noticed: true },
  );
});
const defaultAclCases = [
  ['session-start', { source: 'startup' }, false],
  [
    'post-tool-use',
    {
      tool_name: 'Read',
      tool_input: { file_path: 'fake.txt' },
      tool_response: `key=${FAKE_STRIPE}`,
    },
    true,
  ],
  [
    'post-tool-use',
    {
      tool_name: 'Read',
      tool_input: { file_path: 'fake.txt' },
      tool_response: 'Contact: ZEROHFAKE@example.test',
    },
    true,
  ],
  [
    'post-tool-use',
    {
      tool_name: 'Read',
      tool_input: { file_path: 'fake.txt' },
      tool_response: 'Ordinary work continues.',
    },
    false,
  ],
  [
    'pre-tool-use',
    { tool_name: 'Bash', tool_input: { command: 'echo hi' } },
    false,
  ],
  [
    'pre-tool-use',
    { tool_name: 'Bash', tool_input: { command: `echo ${FAKE_STRIPE}` } },
    true,
  ],
  ['user-prompt-submit', { prompt: `deploy with ${FAKE_STRIPE}` }, true],
  ['user-prompt-submit', { prompt: 'Please review the code.' }, false],
];
for (const [index, [name, event, sensitive]] of defaultAclCases.entries()) {
  test(`known Windows ACL gap preserves 1.0 handling (${name}, ${sensitive ? 'sensitive' : 'ordinary'}, ${index})`, () => {
    const project = tempProject();
    const results = [];
    const outputs = [];
    for (const failure of ['no', 'yes']) {
      const env = environment(project, {
        ZEROH_WORKER_TEST_ACL_FAILURE: failure,
      });
      delete env.ZEROH_UNCERTAIN;
      // Use separate homes so the successful run's v3 marker cannot mask failure.
      env.ZEROH_HOME = path.join(project.home, failure);
      mkdirSync(env.ZEROH_HOME);
      const result = spawnSync(
        process.execPath,
        ['--import', preload, path.join(PLUGIN, 'hooks/run.js'), name],
        {
          env,
          cwd: project.dir,
          encoding: 'utf8',
          timeout: 20000,
          input: JSON.stringify({
            cwd: project.dir,
            session_id: 'ZEROHFAKE-gap',
            ...event,
          }),
        },
      );
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const answer = result.stdout.trim() ? JSON.parse(result.stdout) : {};
      assert.notEqual(answer.decision, 'block');
      assert.notEqual(answer.hookSpecificOutput?.permissionDecision, 'deny');
      if (failure === 'yes') {
        assert.equal(
          (answer.systemMessage || '').split(storageNotice).length - 1,
          name === 'session-start' ? 1 : 0,
          result.stdout,
        );
        if (name === 'session-start')
          answer.systemMessage = answer.systemMessage
            .replace(storageNotice, '')
            .trim();
        if (name === 'session-start')
          assert.ok(existsSync(path.join(env.ZEROH_HOME, 'vault.key')));
        assert.equal(
          existsSync(path.join(env.ZEROH_HOME, '.acl-protected')),
          false,
        );
        assert.equal(
          existsSync(path.join(env.ZEROH_HOME, '.acl-failed')),
          false,
        );
        assert.equal(
          existsSync(path.join(env.ZEROH_HOME, '.acl-applying')),
          false,
        );
      }
      results.push(answer);
      outputs.push(result.stdout);
      if (!sensitive && name === 'post-tool-use')
        assert.equal(
          result.stdout,
          '',
          'ordinary hook keeps its exact empty 1.0 answer',
        );
    }
    if (name !== 'session-start') {
      if (!sensitive && name === 'pre-tool-use')
        assert.equal(
          outputs[1],
          outputs[0],
          'the ordinary PreToolUse answer stays byte-identical',
        );
      // Tokens have per-home keys: compare whether the same output was rewritten,
      // then assert restored source confidentiality for successful masking.
      assert.equal(
        Boolean(results[0].hookSpecificOutput?.updatedToolOutput),
        Boolean(results[1].hookSpecificOutput?.updatedToolOutput),
      );
      if (name === 'post-tool-use' && sensitive) {
        assert.ok(results[1].hookSpecificOutput?.updatedToolOutput);
        assert.ok(!JSON.stringify(results[1]).includes(FAKE_STRIPE));
      }
    }
  });
}

test('WIN11 root verification after a killed restore does not claim children were secured', () => {
  const project = tempProject();
  const module = pathToFileURL(
    path.join(PLUGIN, 'packages/zeroh-disclosure-core/private-fs.js'),
  ).href;
  const file = path.join(project.dir, 'root-status.mjs');
  writeFileSync(
    file,
    `
    import assert from 'node:assert/strict';
    import { readFileSync, writeFileSync } from 'node:fs';
    import path from 'node:path';
    import { prepareWindowsHome, storageProtectionStatus } from ${JSON.stringify(module)};
    let rootPrivate = false, restores = 0;
    const execute = (file, args) => {
      if (file.endsWith('whoami.exe')) return '"ZEROHFAKE","S-1-5-21-123"';
      if (args.includes('/restore')) {
        rootPrivate = true; restores++;
        throw Object.assign(new Error('ZEROHFAKE killed restore'), { code: 'ETIMEDOUT' });
      }
      if (args.includes('/save')) writeFileSync(args[2], path.basename(process.env.ZEROH_HOME) + '\\r\\n' + (rootPrivate ? 'D:P(A;OICI;FA;;;S-1-5-21-123)(A;OICI;FA;;;SY)' : 'D:AI(A;OICI;FA;;;WD)') + '\\r\\n', 'utf16le');
      return '';
    };
    assert.equal(prepareWindowsHome({ execute }), null);
    assert.ok(prepareWindowsHome({ execute }));
    assert.equal(restores, 1);
    assert.equal(storageProtectionStatus(), 'root secured; children may still carry earlier permissions');
    const marker = JSON.parse(readFileSync(path.join(process.env.ZEROH_HOME, '.acl-protected')));
    assert.equal(marker.fullApply, false);
  `,
  );
  const result = spawnSync(process.execPath, ['--import', preload, file], {
    env: environment(project),
    cwd: project.dir,
    encoding: 'utf8',
    timeout: 7000,
  });
  assert.equal(result.status, 0, result.stderr);
});

for (const failure of ['reset-stall', 'grant-stall', 'replace-stall']) {
  test(`ACL ${failure} across the absolute loader exit never broadens a populated home`, () => {
    const project = tempProject();
    const state = path.join(project.dir, 'acl-state');
    writeFileSync(state, 'private');
    writeFileSync(
      path.join(project.home, 'existing-fake'),
      'ZEROHFAKE-private',
    );
    const env = environment(project, {
      ZEROH_WORKER_TEST_ACL_FAILURE: failure,
      ZEROH_WORKER_TEST_ACL_STATE: state,
      ZEROH_HOOK_DEADLINE_MS: '1000',
    });
    const started = performance.now();
    const result = spawnSync(
      process.execPath,
      ['--import', preload, path.join(PLUGIN, 'hooks/run.js'), 'post-tool-use'],
      {
        env,
        cwd: project.dir,
        encoding: 'utf8',
        timeout: 7000,
        input: JSON.stringify({
          cwd: project.dir,
          session_id: 'ZEROHFAKE-stall',
          tool_name: 'Read',
          tool_input: { file_path: 'fake.txt' },
          tool_response: FAKE_STRIPE,
        }),
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(performance.now() - started < 4000);
    assert.ok(JSON.parse(result.stdout).hookSpecificOutput.updatedToolOutput);
    assert.ok(!result.stdout.includes(FAKE_STRIPE));
    assert.equal(readFileSync(state, 'utf8'), 'private');
    assert.equal(
      readFileSync(path.join(project.home, 'existing-fake'), 'utf8'),
      'ZEROHFAKE-private',
    );
    assert.equal(existsSync(path.join(project.home, '.acl-protected')), false);
    assert.ok(
      traceOf(env.ZEROH_WORKER_TEST_TRACE).some((row) =>
        row.args?.includes('/restore'),
      ),
    );
  });
}

test('status reports Windows storage protection separately after a default ACL refusal', () => {
  const project = tempProject();
  const env = environment(project, {
    ZEROH_WORKER_TEST_MAIN_ACL: 'yes',
    ZEROH_WORKER_TEST_ACL_FAILURE: 'yes',
  });
  delete env.ZEROH_UNCERTAIN;
  const check = spawnSync(
    process.execPath,
    [
      '--import',
      preload,
      path.join(PLUGIN, 'hooks/run.js'),
      'user-prompt-submit',
    ],
    {
      env,
      cwd: project.dir,
      encoding: 'utf8',
      timeout: 7000,
      input: JSON.stringify({ cwd: project.dir, prompt: FAKE_STRIPE }),
    },
  );
  assert.equal(check.status, 0, check.stderr);
  const result = spawnSync(
    process.execPath,
    ['--import', preload, path.join(PLUGIN, 'commands/scripts/status.js')],
    { env, cwd: project.dir, encoding: 'utf8', timeout: 7000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Storage protection: not confirmed/u);
  assert.match(result.stdout, /a typed secret is sent/u);
  assert.ok(
    !check.stdout.includes(storageNotice),
    'prompt hooks do not repeat the storage notice',
  );
});

test('WIN7 missing and old markers mean not yet checked in status; successful SessionStart omits storage line', () => {
  for (const version of [null, 2]) {
    const project = tempProject();
    if (version)
      writeFileSync(path.join(project.home, '.acl-protected'), String(version));
    const env = environment(project);
    const result = spawnSync(
      process.execPath,
      ['--import', preload, path.join(PLUGIN, 'commands/scripts/status.js')],
      { env, cwd: project.dir, encoding: 'utf8', timeout: 7000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Storage protection: not yet checked/u);
  }
  const project = tempProject();
  const env = environment(project);
  const result = spawnSync(
    process.execPath,
    ['--import', preload, path.join(PLUGIN, 'hooks/run.js'), 'session-start'],
    {
      env,
      cwd: project.dir,
      encoding: 'utf8',
      timeout: 10000,
      input: JSON.stringify({
        cwd: project.dir,
        session_id: 'ZEROHFAKE-secured',
        source: 'startup',
      }),
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Storage protection:/u);
  const status = spawnSync(
    process.execPath,
    ['--import', preload, path.join(PLUGIN, 'commands/scripts/status.js')],
    { env, cwd: project.dir, encoding: 'utf8', timeout: 7000 },
  );
  assert.match(
    status.stdout,
    /Storage protection: secured with Windows permissions/u,
  );
  assert.ok(
    !traceOf(env.ZEROH_WORKER_TEST_TRACE).some(
      (row) => row.action === 'spawn-with-worker',
    ),
  );
});

test('WIN7 removal heartbeat starts on failed home protection and cleanup still runs', () => {
  const project = tempProject();
  const env = environment(project, {
    ZEROH_WORKER_TEST_MAIN_ACL: 'yes',
    ZEROH_WORKER_TEST_ACL_FAILURE: 'yes',
    ZEROH_REMOVAL_OWNER: 'ZEROHFAKE-owner',
    ZEROH_REMOVAL_LOCK: path.join(project.dir, 'fake.lock'),
  });
  writeFileSync(env.ZEROH_REMOVAL_LOCK, 'ZEROHFAKE-owner');
  const module = pathToFileURL(
    path.join(
      PLUGIN,
      'packages/zeroh-disclosure-core/user-authority/removal.js',
    ),
  ).href;
  const script = path.join(project.dir, 'failed-heartbeat.mjs');
  writeFileSync(
    script,
    `
    import { existsSync } from 'node:fs';
    import { once } from 'node:events';
    import { startRemovalHeartbeat, finishRemoval } from ${JSON.stringify(module)};
    const worker = startRemovalHeartbeat(process.env, { intervalMs: 20 });
    if (!worker) throw new Error('heartbeat missing');
    worker.ref();
    await once(worker, 'online');
    await new Promise(resolve => setTimeout(resolve, 100));
    finishRemoval(process.env.ZEROH_REMOVAL_LOCK);
    if (existsSync(process.env.ZEROH_REMOVAL_LOCK)) throw new Error('cleanup did not run');
    console.log('cleaned');
  `,
  );
  const result = spawnSync(process.execPath, ['--import', preload, script], {
    env,
    cwd: project.dir,
    encoding: 'utf8',
    timeout: 7000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'cleaned');
  assert.equal(existsSync(path.join(project.home, '.acl-protected')), false);
});

test('WIN7 all temporary-session writers honor the memory-only rule, including HTML and audit locks', () => {
  const project = tempProject();
  const env = environment(project, {
    ZEROH_WORKER_TEST_MAIN_ACL: 'yes',
    ZEROH_WORKER_TEST_ACL_FAILURE: 'yes',
  });
  const unavailable = path.join(project.dir, 'ZEROHFAKE-not-a-directory');
  writeFileSync(unavailable, 'ZEROHFAKE');
  env.ZEROH_HOME = path.join(unavailable, 'zeroh');
  const base = (name) =>
    pathToFileURL(path.join(PLUGIN, 'packages/zeroh-disclosure-core', name))
      .href;
  const script = path.join(project.dir, 'memory-writers.mjs');
  writeFileSync(
    script,
    `
    import assert from 'node:assert/strict';
    import { readdirSync } from 'node:fs';
    import { loadSession, writeTurn, writeReceiptBundle } from ${JSON.stringify(base('session.js'))};
    import { writeSessionReceiptHtml, recordDestinationCheck } from ${JSON.stringify(base('report/collect.js'))};
    import { verifyStopReceipts } from ${JSON.stringify(base('stop-verifications.js'))};
    const session = await loadSession({ cwd: process.cwd(), sessionId: 'ZEROHFAKE' });
    await writeTurn({ dir: session.dir, turn: 1, payload: { text: 'ZEROHFAKE-private' } });
    await writeReceiptBundle({ dir: session.dir, bundle: { text: 'ZEROHFAKE-private' } });
    await writeSessionReceiptHtml({ session, previews: false, turns: [] });
    await writeSessionReceiptHtml({ session, turns: [] });
    session.state.turnCount = 1;
    await recordDestinationCheck({ session, hosts: ['ZEROHFAKE.example.test'] });
    await verifyStopReceipts({ session, entries: [], implementation: 'ZEROHFAKE' });
    assert.deepEqual(readdirSync(session.dir), []);
    console.log('memory-only');
  `,
  );
  const result = spawnSync(process.execPath, ['--import', preload, script], {
    env,
    cwd: project.dir,
    encoding: 'utf8',
    timeout: 7000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'memory-only');
});

test('WIN7 bookkeeping on a real hook timeout never spawns in a process with a live worker', () => {
  const project = tempProject();
  const broken = path.join(project.dir, 'slow-plugin');
  cpSync(PLUGIN, broken, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules`),
  });
  writeFileSync(path.join(broken, 'hooks/post-tool-use.js'), 'for (;;) {}');
  const env = environment(project, {
    ZEROH_HOOK_DEADLINE_MS: '1000',
  });
  const result = spawnSync(
    process.execPath,
    ['--import', preload, path.join(broken, 'hooks/run.js'), 'post-tool-use'],
    {
      env,
      cwd: project.dir,
      encoding: 'utf8',
      timeout: 7000,
      input: JSON.stringify({
        cwd: project.dir,
        session_id: 'ZEROHFAKE-timeout',
        tool_name: 'Read',
        tool_response: FAKE_STRIPE,
      }),
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).hookSpecificOutput.updatedToolOutput);
  const trace = traceOf(env.ZEROH_WORKER_TEST_TRACE);
  assert.ok(
    trace.some((row) => row.action === 'worker-created' && row.bookkeeping),
  );
  assert.ok(!trace.some((row) => row.action === 'spawn-with-worker'));
  // Join a real bookkeeping entry by message and exit, with another worker
  // live throughout. This proves actual heartbeat/status persistence without
  // relying on the hook's deliberately short best-effort scheduling window.
  const adapter = pathToFileURL(
    path.join(PLUGIN, 'packages/zeroh-disclosure-core/child-process.js'),
  ).href;
  const privateFs = pathToFileURL(
    path.join(PLUGIN, 'packages/zeroh-disclosure-core/private-fs.js'),
  ).href;
  const status = pathToFileURL(
    path.join(PLUGIN, 'packages/zeroh-disclosure-core/session-status.js'),
  ).href;
  const entry = path.join(PLUGIN, 'hooks/timeout-bookkeeping.js');
  const parent = path.join(project.dir, 'joined-bookkeeping.mjs');
  writeFileSync(
    parent,
    `
    import assert from 'node:assert/strict';
    import { once } from 'node:events';
    import { readFileSync, existsSync } from 'node:fs';
    import path from 'node:path';
    import { Worker } from 'node:worker_threads';
    import { startWindowsSubprocessHost, stopWindowsSubprocessHost, serveWorkerSubprocesses } from ${JSON.stringify(adapter)};
    import { prepareWindowsHome } from ${JSON.stringify(privateFs)};
    import { sessionStatusPath } from ${JSON.stringify(status)};
    const protectedHome = await prepareWindowsHome({ execute() { throw new Error('expected warm home'); } });
    assert.ok(protectedHome);
    await startWindowsSubprocessHost();
    const idle = new Worker('require("node:worker_threads").parentPort.postMessage("ready");setInterval(() => {}, 1000)', { eval: true });
    await once(idle, 'message');
    const bookkeeping = new Worker(${JSON.stringify(entry)}, { workerData: {
      name: 'post-tool-use', event: { cwd: process.cwd(), session_id: 'ZEROHFAKE-joined-bookkeeping' },
      raw: '{}', count: false, ok: true, storagePreflight: true, protectedHome,
    } });
    serveWorkerSubprocesses(bookkeeping);
    const exited = once(bookkeeping, 'exit');
    await once(bookkeeping, 'message');
    const [code] = await exited;
    assert.equal(code, 0);
    const file = sessionStatusPath(process.cwd(), 'ZEROHFAKE-joined-bookkeeping');
    assert.ok(JSON.parse(readFileSync(file)).hooks['post-tool-use'].ok_at);
    assert.ok(existsSync(path.join(path.dirname(file), 'hooks.alive')));
    await idle.terminate();
    stopWindowsSubprocessHost();
  `,
  );
  const joined = spawnSync(process.execPath, ['--import', preload, parent], {
    env,
    cwd: project.dir,
    encoding: 'utf8',
    timeout: 7000,
  });
  assert.equal(joined.status, 0, joined.stderr);
  const exercised = traceOf(env.ZEROH_WORKER_TEST_TRACE);
  assert.ok(
    exercised.some((row) => row.action === 'worker-entry' && row.bookkeeping),
  );
  assert.ok(!exercised.some((row) => row.action === 'spawn-with-worker'));
});

test('WIN7 a prestarted subprocess host handles synchronous results and streaming stdin without worker-time spawn', () => {
  const project = tempProject();
  const env = environment(project);
  const adapter = pathToFileURL(
    path.join(PLUGIN, 'packages/zeroh-disclosure-core/child-process.js'),
  ).href;
  const fixture = pathToFileURL(
    path.join(PLUGIN, 'test/tools/worker-child-process-fixture.mjs'),
  ).href;
  const workerFile = path.join(project.dir, 'async-host-worker.mjs');
  writeFileSync(
    workerFile,
    `
    import { once } from 'node:events';
    import { spawn, execFileSync } from ${JSON.stringify(adapter)};
    if (execFileSync(process.execPath, ['-p', 'process.cwd()'], { encoding: 'utf8' }).trim() !== process.cwd()) throw new Error('worker cwd lost');
    await import(${JSON.stringify(fixture)});
    const missing = spawn(${JSON.stringify(path.join(project.dir, 'ZEROHFAKE-never-installed.exe'))}, [], { stdio: 'ignore' });
    const [failure] = await once(missing, 'error');
    if (failure.code !== 'ENOENT') throw new Error('missing command result lost');
    const child = spawn(process.execPath, ['-e',
      'let text="";process.stdin.on("data", chunk => text += chunk);process.stdin.on("end", () => require("node:fs").writeFileSync(process.argv[1], text));',
      ${JSON.stringify(path.join(project.dir, 'fake-clipboard'))}], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.end('ZEROHFAKE-clipboard');
    const [code] = await once(child, 'close');
    if (code !== 0) throw new Error('async child failed');
  `,
  );
  const parent = path.join(project.dir, 'host-parent.mjs');
  writeFileSync(
    parent,
    `
    import { once } from 'node:events';
    import { Worker } from 'node:worker_threads';
    import { startWindowsSubprocessHost, stopWindowsSubprocessHost, serveWorkerSubprocesses } from ${JSON.stringify(adapter)};
    await startWindowsSubprocessHost();
    const worker = new Worker(${JSON.stringify(workerFile)});
    let unavailable = 0;
    serveWorkerSubprocesses(worker, { onUnavailable() { unavailable++; } });
    const [code] = await once(worker, 'exit');
    if (unavailable !== 0) throw new Error('ordinary command error misreported as host loss');
    stopWindowsSubprocessHost();
    process.exitCode = code;
  `,
  );
  const result = spawnSync(process.execPath, ['--import', preload, parent], {
    env,
    cwd: project.dir,
    encoding: 'utf8',
    timeout: 12000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(path.join(project.dir, 'fake-clipboard'), 'utf8'),
    'ZEROHFAKE-clipboard',
  );
  const trace = traceOf(env.ZEROH_WORKER_TEST_TRACE);
  assert.ok(
    trace.some(
      (row) => row.action === 'async-child' && row.file === 'ZEROHFAKE-ok',
    ),
  );
  assert.ok(!trace.some((row) => row.action === 'spawn-with-worker'));
});

test('WIN10 unconfirmed workers write keys and private files with no ACL subprocess or host', () => {
  const project = tempProject();
  const env = environment(project, { ZEROH_WORKER_TEST_ACL_FAILURE: 'yes' });
  const base = (name) =>
    pathToFileURL(path.join(PLUGIN, 'packages/zeroh-disclosure-core', name))
      .href;
  const parent = path.join(project.dir, 'unconfirmed-writes.mjs');
  const child = path.join(project.dir, 'unconfirmed-worker.mjs');
  writeFileSync(
    child,
    `
    import assert from 'node:assert/strict';
    import { parentPort } from 'node:worker_threads';
    import { writePrivateFile, protectWindowsPath, storageProtectionStatus } from ${JSON.stringify(base('private-fs.js'))};
    import { loadKey } from ${JSON.stringify(base('vault/store.js'))};
    assert.equal(storageProtectionStatus(), 'not confirmed');
    assert.equal(protectWindowsPath(process.env.ZEROH_HOME), false);
    assert.equal(loadKey().length, 32);
    writePrivateFile(process.env.ZEROH_HOME + '/private-fake', 'ZEROHFAKE');
    parentPort.postMessage('ready');
  `,
  );
  writeFileSync(
    parent,
    `
    import assert from 'node:assert/strict';
    import { Worker } from 'node:worker_threads';
    import { once } from 'node:events';
    import { prepareWindowsHome } from ${JSON.stringify(base('private-fs.js'))};
    assert.equal(prepareWindowsHome(), null);
    const worker = new Worker(${JSON.stringify(child)}, { workerData: { storagePreflight: true, protectedHome: null } });
    const exited = once(worker, 'exit');
    assert.deepEqual(await once(worker, 'message'), ['ready']);
    assert.deepEqual(await exited, [0]);
  `,
  );
  const result = spawnSync(process.execPath, ['--import', preload, parent], {
    env,
    cwd: project.dir,
    encoding: 'utf8',
    timeout: 7000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(path.join(project.home, 'private-fake'), 'utf8'),
    'ZEROHFAKE',
  );
  assert.equal(readFileSync(path.join(project.home, 'vault.key')).length, 32);
  const trace = traceOf(env.ZEROH_WORKER_TEST_TRACE);
  assert.ok(trace.some((row) => row.action === 'sync-child'));
  assert.ok(
    !trace.some(
      (row) =>
        row.action === 'host-start' ||
        row.action === 'forbidden-sync' ||
        row.action === 'spawn-with-worker',
    ),
  );
  assert.ok(
    trace
      .filter((row) => /whoami|icacls/iu.test(row.file || ''))
      .every((row) => row.liveWorkers === 0 && row.threadId === 0),
  );
});

test('WIN10 detached uninstall can start from an unconfirmed worker without ACL requests', () => {
  const project = tempProject();
  const copy = path.join(project.dir, 'removal-plugin');
  cpSync(PLUGIN, copy, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules`),
  });
  writeFileSync(
    path.join(copy, 'bin/zeroh-disclosure.mjs'),
    'import { writeFileSync } from "node:fs"; writeFileSync(process.env.ZEROH_REMOVAL_LOG_DIR + "/completed", "ZEROHFAKE");',
  );
  const base = (name) =>
    pathToFileURL(path.join(copy, 'packages/zeroh-disclosure-core', name)).href;
  const child = path.join(project.dir, 'removal-worker.mjs');
  writeFileSync(
    child,
    `
    import { parentPort } from 'node:worker_threads';
    import { startDetachedRemoval } from ${JSON.stringify(base('user-authority/removal.js'))};
    const log = startDetachedRemoval({ argv: ['uninstall', '--yes'], cwd: process.cwd(), env: process.env, onLog() {} });
    parentPort.postMessage(log);
  `,
  );
  const parent = path.join(project.dir, 'removal-parent.mjs');
  writeFileSync(
    parent,
    `
    import assert from 'node:assert/strict';
    import { once } from 'node:events';
    import { existsSync, readFileSync } from 'node:fs';
    import path from 'node:path';
    import { Worker } from 'node:worker_threads';
    import { prepareWindowsHome } from ${JSON.stringify(base('private-fs.js'))};
    import { startWindowsSubprocessHost, stopWindowsSubprocessHost, serveWorkerSubprocesses } from ${JSON.stringify(base('child-process.js'))};
    assert.equal(prepareWindowsHome(), null);
    await startWindowsSubprocessHost();
    const worker = new Worker(${JSON.stringify(child)}, { workerData: { storagePreflight: true, protectedHome: null } });
    serveWorkerSubprocesses(worker);
    const exited = once(worker, 'exit');
    const log = await new Promise(resolve => worker.on('message', message => { if (typeof message === 'string') resolve(message); }));
    assert.deepEqual(await exited, [0]);
    const completed = path.join(path.dirname(log), 'completed');
    const end = Date.now() + 3000;
    while (!existsSync(completed) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(readFileSync(completed, 'utf8'), 'ZEROHFAKE');
    stopWindowsSubprocessHost();
  `,
  );
  const env = environment(project, { ZEROH_WORKER_TEST_ACL_FAILURE: 'yes' });
  const result = spawnSync(process.execPath, ['--import', preload, parent], {
    env,
    cwd: project.dir,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const trace = traceOf(env.ZEROH_WORKER_TEST_TRACE);
  assert.ok(
    trace.some(
      (row) => row.action === 'native-child' && row.args?.includes('--yes'),
    ),
  );
  assert.ok(
    !trace.some(
      (row) =>
        row.action === 'forbidden-sync' || row.action === 'spawn-with-worker',
    ),
  );
  assert.ok(
    trace
      .filter((row) => /whoami|icacls/iu.test(row.file || ''))
      .every((row) => row.liveWorkers === 0),
  );
});

test('WIN10 copied success and failure records do not confirm a replacement folder', () => {
  const project = tempProject();
  const module = pathToFileURL(
    path.join(PLUGIN, 'packages/zeroh-disclosure-core/private-fs.js'),
  ).href;
  const file = path.join(project.dir, 'replacement-status.mjs');
  writeFileSync(
    file,
    `
    import assert from 'node:assert/strict';
    import { cpSync, mkdirSync, renameSync } from 'node:fs';
    import { prepareWindowsHome, storageProtectionStatus } from ${JSON.stringify(module)};
    const env = process.env;
    assert.ok(prepareWindowsHome());
    assert.equal(storageProtectionStatus(), 'secured with Windows permissions');
    renameSync(env.ZEROH_HOME, env.ZEROH_HOME + '-old');
    mkdirSync(env.ZEROH_HOME);
    cpSync(env.ZEROH_HOME + '-old/.acl-protected', env.ZEROH_HOME + '/.acl-protected');
    assert.equal(storageProtectionStatus(), 'not yet checked');
    assert.equal(prepareWindowsHome({ execute() { throw new Error('ZEROHFAKE refused'); } }), null);
    assert.equal(storageProtectionStatus(), 'not confirmed');
    renameSync(env.ZEROH_HOME, env.ZEROH_HOME + '-failed');
    mkdirSync(env.ZEROH_HOME);
    cpSync(env.ZEROH_HOME + '-failed/.acl-status.json', env.ZEROH_HOME + '/.acl-status.json');
    assert.equal(storageProtectionStatus(), 'not yet checked');
  `,
  );
  const result = spawnSync(process.execPath, ['--import', preload, file], {
    env: environment(project),
    encoding: 'utf8',
    timeout: 7000,
  });
  assert.equal(result.status, 0, result.stderr);
});
