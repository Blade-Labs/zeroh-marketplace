// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  utimesSync,
  writeFileSync,
  mkdtempSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { FAKE_STRIPE, PLUGIN, tempProject } from '../helpers.mjs';
import { monorepoOnly } from '../monorepo.mjs';
import { verifiedWindowsDacl } from '../../packages/zeroh-disclosure-core/windows-acl.js';
import { spawnHookSync } from '../tools/hook-child.mjs';

const preload = pathToFileURL(
  path.join(PLUGIN, 'test/tools/worker-child-process-preload.mjs'),
).href;
const core = (name) =>
  pathToFileURL(path.join(PLUGIN, 'packages/zeroh-disclosure-core', name)).href;
function environment(project, extra = {}) {
  return {
    ...process.env,
    HOME: project.home,
    USERPROFILE: project.home,
    ZEROH_HOME: project.home,
    ZEROH_PROXY: 'off',
    ZEROH_WORKER_TEST_TRACE: path.join(project.dir, 'trace.jsonl'),
    ...extra,
  };
}
function runHook(project, name, event, extra = {}, plugin = PLUGIN) {
  return spawnHookSync(
    process.execPath,
    ['--import', preload, path.join(plugin, 'hooks/run.js'), name],
    {
      env: environment(project, extra),
      cwd: project.dir,
      input: JSON.stringify({
        cwd: project.dir,
        session_id: 'ZEROHFAKE-win8',
        ...event,
      }),
      encoding: 'utf8',
      timeout: 15000,
    },
  );
}
function trace(project) {
  const file = path.join(project.dir, 'trace.jsonl');
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}
function copyPlugin(project) {
  const plugin = path.join(project.dir, 'plugin');
  cpSync(PLUGIN, plugin, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules`),
  });
  return plugin;
}

test('WIN13 host failure instrumentation recognizes both native path separators', () => {
  for (const host of [
    '/ZEROHFAKE/core/subprocess-host.js',
    'C:\\ZEROHFAKE\\core\\subprocess-host.js',
  ]) {
    for (const scenario of ['start-failure', 'error']) {
      const project = tempProject();
      const script = path.join(project.dir, 'host-instrumentation.mjs');
      writeFileSync(
        script,
        `
        import assert from 'node:assert/strict';
        import cp from 'node:child_process';
        import { EventEmitter, once } from 'node:events';
        let sends = 0;
        cp.spawn = () => {
          const child = new EventEmitter();
          child.send = () => { sends++; return true; };
          return child;
        };
        await import(${JSON.stringify(preload)});
        const child = cp.spawn(process.execPath, [${JSON.stringify(host)}], { cwd: process.cwd() });
        const failed = once(child, 'error');
        if (${JSON.stringify(scenario)} === 'error') {
          child.send({ id: 1 });
          assert.equal(sends, 0, 'IPC failure must intercept the request');
        }
        const [error] = await failed;
        assert.equal(error.code, ${JSON.stringify(scenario === 'error' ? 'EPIPE' : 'EACCES')});
        if (${JSON.stringify(scenario)} === 'error') {
          child.send({ id: 2 });
          assert.equal(sends, 1, 'IPC failure injection is one-shot');
        }
      `,
      );
      const result = spawnSync(process.execPath, [script], {
        env: environment(project, {
          ...(scenario === 'start-failure'
            ? { ZEROH_WORKER_TEST_HOST_FAILURE: 'yes' }
            : { ZEROH_WORKER_TEST_HOST_DEATH: 'error' }),
        }),
        cwd: project.dir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(result.status, 0, `${scenario}: ${host}\n${result.stderr}`);
      assert.equal(
        trace(project).filter((row) => row.action === 'host-start').length,
        1,
        host,
      );
    }
  }
});

test('WIN8 an uncreatable Windows home uses ephemeral memory storage and the configured uncertainty mode', () => {
  for (const mode of ['pass', 'block']) {
    const project = tempProject();
    const file = path.join(project.dir, 'ZEROHFAKE-file');
    writeFileSync(file, 'ZEROHFAKE');
    const home = path.join(file, 'zeroh');
    const script = path.join(project.dir, 'ephemeral.mjs');
    writeFileSync(
      script,
      `
      import assert from 'node:assert/strict';
      import { readdirSync } from 'node:fs';
      import { Worker } from 'node:worker_threads';
      import { once } from 'node:events';
      import { serveWorkerSubprocesses } from ${JSON.stringify(core('child-process.js'))};
      const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(\`
        import { parentPort } from 'node:worker_threads';
        import { loadSession, writeTurn } from ${JSON.stringify(core('session.js'))};
        import { loadKey } from ${JSON.stringify(core('vault/store.js'))};
        import { readdirSync } from 'node:fs';
        const session = await loadSession({ cwd: process.cwd(), sessionId: 'ZEROHFAKE-memory' });
        await writeTurn({ dir: session.dir, turn: 1, payload: { text: 'ZEROHFAKE' } });
        parentPort.postMessage({ ephemeral: session.ephemeral, memory: session.memoryOnly,
          files: readdirSync(session.dir), key: loadKey().equals(loadKey()) });
      \`)));
      serveWorkerSubprocesses(worker);
      const result = await new Promise(resolve => worker.on('message', message => { if (message?.ephemeral !== undefined) resolve(message); }));
      assert.deepEqual(result, { ephemeral: true, memory: true, files: [], key: true });
    `,
    );
    const memory = spawnSync(process.execPath, ['--import', preload, script], {
      env: environment(project, { ZEROH_HOME: home }),
      cwd: project.dir,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(memory.status, 0, memory.stderr);
    for (const [name, event] of [
      ['pre-tool-use', { tool_name: 'Bash', tool_input: { command: 'ls' } }],
      ['user-prompt-submit', { prompt: 'Explain this ordinary code' }],
      [
        'post-tool-use',
        { tool_name: 'Bash', tool_response: 'ZEROHFAKE ordinary output' },
      ],
    ]) {
      const result = runHook(project, name, event, {
        ZEROH_HOME: home,
        ...(mode === 'block' ? { ZEROH_UNCERTAIN: 'block' } : {}),
      });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      if (mode === 'pass')
        assert.doesNotMatch(
          result.stdout,
          /"decision":"block"|"permissionDecision":"deny"|output withheld/iu,
        );
      const ordinary = runHook(project, name, event, {
        ...(mode === 'block' ? { ZEROH_UNCERTAIN: 'block' } : {}),
      });
      assert.equal(ordinary.status, 0, ordinary.stderr);
      assert.equal(result.stdout, ordinary.stdout);
    }
  }
});

test('WIN8 SDDL local account and service aliases match only the proven current user', async () => {
  const account = 'S-1-5-21-111-222-333-';
  const record = (alias) =>
    `ZEROHFAKE\r\nD:P(A;OICI;FA;;;${alias})(A;OICI;FA;;;SY)\r\n`;
  for (const [alias, sid] of [
    ['LA', account + '500'],
    ['LG', account + '501'],
    ['LS', 'S-1-5-19'],
    ['NS', 'S-1-5-20'],
    ['AN', 'S-1-5-7'],
  ]) {
    assert.equal(
      verifiedWindowsDacl(record(alias), 'ZEROHFAKE', sid, true),
      true,
      alias,
    );
    assert.equal(
      verifiedWindowsDacl(record(alias), 'ZEROHFAKE', account + '1001', true),
      false,
      alias,
    );
  }
  for (const alias of ['BA', 'BG', 'DA', 'DG', 'DU', 'CO', 'OW', 'PS'])
    assert.equal(
      verifiedWindowsDacl(record(alias), 'ZEROHFAKE', account + '500', true),
      false,
      alias,
    );
  assert.equal(
    verifiedWindowsDacl(record('LA'), 'ZEROHFAKE', account + '501', true),
    false,
  );
  assert.equal(
    verifiedWindowsDacl(record('LG'), 'ZEROHFAKE', account + '500', true),
    false,
  );
  assert.equal(
    verifiedWindowsDacl(record('LA'), 'ZEROHFAKE', account + '500', false),
    false,
  );
  assert.equal(
    verifiedWindowsDacl(
      record('LA'),
      'ZEROHFAKE',
      'S-1-12-1-111-222-333-500',
      true,
    ),
    false,
  );
  const { protectWindowsPath } =
    await import('../../packages/zeroh-disclosure-core/windows-acl.js');
  const actualHostname = os.hostname;
  os.hostname = () => 'ZEROHFAKE-PC.example.test';
  try {
    for (const [authority, machine] of [
      ['ZEROHFAKE-PC', 'ZEROHFAKE-PC'],
      ['ZEROHFAKE-DOMAIN', 'ZEROHFAKE-PC'],
      ['ZEROHFAKE-PC', 'ZEROHFAKE-OTHER'],
    ]) {
      const project = tempProject();
      let restores = 0;
      const ok = await protectWindowsPath(project.home, {
        platform: 'win32',
        env: { COMPUTERNAME: 'ZEROHFAKE-PC' },
        execute: (file, args) => {
          if (file.endsWith('powershell.exe')) return machine;
          if (file.endsWith('whoami.exe'))
            return `"${authority}\\administrator","${account}500"`;
          if (args.includes('/save'))
            writeFileSync(
              args[2],
              record('LA').replace(
                'ZEROHFAKE\r\n',
                `${path.basename(project.home)}\r\n`,
              ),
              'utf16le',
            );
          if (args.includes('/restore')) restores++;
          return '';
        },
      });
      const local = authority === 'ZEROHFAKE-PC' && machine === 'ZEROHFAKE-PC';
      assert.equal(ok, local);
      assert.equal(restores, local ? 0 : 1);
    }
  } finally {
    os.hostname = actualHostname;
  }
});

test('WIN8 only subprocess-capable hooks start a host, before workers exist', () => {
  for (const [name, event, starts] of [
    ['session-start', { source: 'startup' }, true],
    ['user-prompt-submit', { prompt: 'Explain code' }, true],
    [
      'pre-tool-use',
      { tool_name: 'Bash', tool_input: { command: 'ls' } },
      false,
    ],
    [
      'post-tool-use',
      {
        tool_name: 'Read',
        tool_input: { file_path: 'fake.txt' },
        tool_response: 'ordinary',
      },
      false,
    ],
    [
      'post-tool-use',
      {
        tool_name: 'Read',
        tool_input: { file_path: 'fake.pdf' },
        tool_response: 'ordinary',
      },
      false,
    ],
    ['stop', {}, false],
    ['session-end', {}, false],
    ['tool-not-run', {}, false],
    ['message-display', { message: 'ordinary' }, false],
  ]) {
    const project = tempProject();
    // Node deduplicates Windows env keys: inherited PATH can beat Path.
    // No PATH tools are needed: Node is absolute and ACL calls are mocked.
    const emptyPath = mkdtempSync(path.join(project.dir, 'empty-path-'));
    const result = runHook(project, name, event, {
      PATH: emptyPath,
      Path: emptyPath,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(
      trace(project).filter((row) => row.action === 'host-start').length,
      Number(starts),
      name,
    );
    assert.ok(
      !trace(project).some((row) => row.action === 'spawn-with-worker'),
      name,
    );
  }
  // Windows discovers an actual fake .exe outside the hook's project cwd.
  // Linux models the Windows candidate spelling with a test-only exists probe.
  // The empty hook body never executes the fake adapter.
  const project = tempProject();
  const tools = mkdtempSync(path.join(project.dir, 'pdf-tools-'));
  writeFileSync(path.join(tools, 'pdftotext.exe'), 'ZEROHFAKE not executable');
  const dir = process.platform === 'win32' ? tools : 'C:\\ZEROHFAKE-tools';
  const candidate = path.win32.join(dir, 'pdftotext.exe');
  const plugin = copyPlugin(project);
  writeFileSync(path.join(plugin, 'hooks/post-tool-use.js'), '');
  const discover = path.join(project.dir, 'pdf-discovery.mjs');
  writeFileSync(
    discover,
    `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; const original = fs.existsSync; fs.existsSync = file => file === ${JSON.stringify(candidate)} || original(file); syncBuiltinESMExports();`,
  );
  const result = spawnHookSync(
    process.execPath,
    [
      '--import',
      preload,
      ...(process.platform === 'win32'
        ? []
        : ['--import', pathToFileURL(discover).href]),
      path.join(plugin, 'hooks/run.js'),
      'post-tool-use',
    ],
    {
      env: environment(project, { PATH: dir, Path: dir }),
      cwd: project.dir,
      encoding: 'utf8',
      timeout: 10000,
      input: JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: 'fake.PDF' },
      }),
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    trace(project).filter((row) => row.action === 'host-start').length,
    1,
  );
});

test('WIN8 host start failure preserves ordinary work with a visible notice', () => {
  for (const [name, event] of [
    ['user-prompt-submit', { prompt: 'Explain this ordinary code' }],
    ['session-start', { source: 'startup' }],
  ]) {
    const project = tempProject();
    const result = runHook(project, name, event, {
      ZEROH_WORKER_TEST_HOST_FAILURE: 'yes',
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const answer = JSON.parse(result.stdout);
    assert.notEqual(answer.decision, 'block');
    assert.match(answer.systemMessage, /subprocess service is unavailable/u);
    assert.doesNotMatch(result.stdout, /hook failed|unchecked/iu);
    assert.ok(trace(project).some((row) => row.action === 'worker-entry'));
    assert.ok(
      !trace(project).some((row) => row.action === 'spawn-with-worker'),
    );
  }
});

for (const scenario of [
  'no-host',
  'death',
  'disconnect',
  'error',
  'start-failure',
]) {
  test(`WIN8 ${scenario} answers two spawn requests immediately and the hook continues with a notice`, () => {
    const project = tempProject();
    const plugin = copyPlugin(project);
    const name = scenario === 'no-host' ? 'pre-tool-use' : 'user-prompt-submit';
    if (scenario === 'disconnect')
      writeFileSync(
        path.join(plugin, 'packages/zeroh-disclosure-core/subprocess-host.js'),
        `process.on('message', () => process.disconnect());`,
      );
    if (scenario === 'death')
      writeFileSync(
        path.join(plugin, 'packages/zeroh-disclosure-core/subprocess-host.js'),
        `process.on('message', () => process.exit(0));`,
      );
    writeFileSync(
      path.join(plugin, 'hooks', `${name}.js`),
      `
      import assert from 'node:assert/strict';
      import { spawnSync, execFileSync, spawn } from '../packages/zeroh-disclosure-core/child-process.js';
      import { once } from 'node:events';
      const start = performance.now();
      const first = spawnSync('ZEROHFAKE-ok', []);
      const second = spawnSync('ZEROHFAKE-ok', [], { timeout: 2000 });
      assert.ok(first.error && second.error);
      assert.throws(() => execFileSync('ZEROHFAKE-ok', []));
      const child = spawn('ZEROHFAKE-ok', [], { stdio: 'ignore' });
      const [error] = await once(child, 'error');
      assert.ok(error.code);
      assert.ok(performance.now() - start < 1000, 'dead/no host request was not immediate');
      process.stdout.write(JSON.stringify({ systemMessage: 'ZEROHFAKE ordinary work continued' }));
    `,
    );
    const result = runHook(
      project,
      name,
      {},
      scenario === 'start-failure'
        ? { ZEROH_WORKER_TEST_HOST_FAILURE: 'yes' }
        : scenario === 'error'
          ? { ZEROH_WORKER_TEST_HOST_DEATH: 'error' }
          : {},
      plugin,
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const answer = JSON.parse(result.stdout);
    assert.match(answer.systemMessage, /ordinary work continued/u);
    assert.match(answer.systemMessage, /subprocess service is unavailable/u);
    assert.ok(
      !trace(project).some((row) => row.action === 'spawn-with-worker'),
    );
    assert.ok(
      !trace(project).some(
        (row) => row.action === 'async-child' && row.file === 'ZEROHFAKE-ok',
      ),
    );
  });
}

test('WIN8 Unix process identity retries null discovery on Linux and macOS', () => {
  for (const platform of ['linux', 'darwin']) {
    const project = tempProject();
    const script = path.join(project.dir, 'identity.mjs');
    writeFileSync(
      script,
      `
      import assert from 'node:assert/strict';
      import fs from 'node:fs'; import cp from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
      let calls = 0;
      const read = fs.readFileSync;
      fs.readFileSync = (file, ...args) => {
        if (file === '/proc/' + process.pid + '/stat') {
          if (++calls === 1) throw new Error('ZEROHFAKE transient failure');
          return process.pid + ' (ZEROHFAKE) ' + ['S', ...Array(18).fill('0'), '123456789'].join(' ');
        }
        return read(file, ...args);
      };
      cp.spawnSync = () => ({ status: ++calls === 1 ? 1 : 0, stdout: 'ZEROHFAKE-start' });
      syncBuiltinESMExports();
      const { uninstallOwner } = await import(${JSON.stringify(core('uninstall-handoff.js'))});
      assert.equal(uninstallOwner().process_start, null);
      assert.ok(uninstallOwner().process_start);
      assert.equal(calls, 2);
    `,
    );
    const result = spawnSync(process.execPath, [script], {
      env: environment(project),
      cwd: project.dir,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('WIN10 docs disclose known-gap interrupted propagation and CI prints only the RID', async (t) => {
  const docs = readFileSync(
    path.join(PLUGIN, 'docs/windows-storage.md'),
    'utf8',
  );
  assert.match(docs, /reboot or logoff/iu);
  assert.match(docs, /earlier inherited entries/iu);
  await t.test(
    'CI prints only the Windows runner RID',
    { skip: monorepoOnly('.github/workflows/zeroh-disclosure.yml') },
    () => {
      const workflow = readFileSync(
        path.join(PLUGIN, '../../../../.github/workflows/zeroh-disclosure.yml'),
        'utf8',
      );
      const step = workflow
        .split('- name: Diagnose Windows runner account RID')[1]
        ?.split('- name:')[0];
      assert.ok(step);
      assert.match(step, /Write-Output "Windows runner RID: \$rid"/u);
      assert.doesNotMatch(step, /Write-Output.*\$sid/u);
    },
  );
});

test('WIN8 a streaming child gets error and close on host loss; the next request fails immediately', () => {
  const project = tempProject();
  const plugin = copyPlugin(project);
  writeFileSync(
    path.join(plugin, 'packages/zeroh-disclosure-core/subprocess-host.js'),
    `
    process.on('message', message => {
      if (message.control) process.exit(0);
      else process.send({ id: message.id, streaming: true, result: { pid: 123, status: 0 } });
    });
  `,
  );
  writeFileSync(
    path.join(plugin, 'hooks/user-prompt-submit.js'),
    `
    import assert from 'node:assert/strict'; import { once } from 'node:events';
    import { spawn, spawnSync } from '../packages/zeroh-disclosure-core/child-process.js';
    const child = spawn('ZEROHFAKE-streaming', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    const closed = new Promise(resolve => child.once('close', resolve));
    const failed = once(child, 'error');
    child.stdin.end('ZEROHFAKE');
    const [error] = await failed;
    assert.equal(error.code, 'EPIPE');
    await closed;
    assert.equal(spawnSync('ZEROHFAKE-next', []).error.code, 'EPIPE');
    process.stdout.write(JSON.stringify({ systemMessage: 'ZEROHFAKE ordinary work continued' }));
  `,
  );
  const result = runHook(project, 'user-prompt-submit', {}, {}, plugin);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(
    JSON.parse(result.stdout).systemMessage,
    /ordinary work continued.*subprocess service is unavailable/su,
  );
  assert.ok(!trace(project).some((row) => row.action === 'spawn-with-worker'));
});

test('WIN8 failed host startup degrades proxy startup and clipboard without unchecked work', () => {
  const project = tempProject();
  const result = runHook(
    project,
    'session-start',
    { source: 'startup' },
    {
      ZEROH_PROXY: 'on',
      ZEROH_WORKER_TEST_HOST_FAILURE: 'yes',
    },
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const answer = JSON.parse(result.stdout);
  assert.match(answer.systemMessage, /could not start/iu);
  assert.match(answer.systemMessage, /subprocess service is unavailable/u);
  assert.doesNotMatch(result.stdout, /hook failed|unchecked/iu);
  const plugin = copyPlugin(project);
  writeFileSync(
    path.join(plugin, 'hooks/user-prompt-submit.js'),
    `
    import assert from 'node:assert/strict';
    import { writeClipboard } from '../lib/clipboard.js';
    assert.equal(await writeClipboard('ZEROHFAKE-masked-copy'), null);
    process.stdout.write(JSON.stringify({ systemMessage: 'ZEROHFAKE ordinary work continued' }));
  `,
  );
  const clipboard = runHook(
    project,
    'user-prompt-submit',
    {},
    { ZEROH_WORKER_TEST_HOST_FAILURE: 'yes' },
    plugin,
  );
  assert.equal(clipboard.status, 0, clipboard.stderr + clipboard.stdout);
  assert.match(
    JSON.parse(clipboard.stdout).systemMessage,
    /ordinary work continued.*subprocess service is unavailable/su,
  );
  assert.ok(!trace(project).some((row) => row.action === 'spawn-with-worker'));
});

test('WIN8 a no-host PDF request uses the built-in extractor and a visible notice', () => {
  const project = tempProject();
  const plugin = copyPlugin(project);
  const file = path.join(project.dir, 'fake.pdf');
  writeFileSync(
    file,
    `%PDF-1.4\n1 0 obj\n<< /Type /Page /Contents 2 0 R >>\nendobj\n2 0 obj\n<< >>\nstream\nBT (ZEROHFAKE useful document text is here) Tj ET\nendstream\nendobj\n%%EOF`,
  );
  writeFileSync(
    path.join(plugin, 'hooks/pre-tool-use.js'),
    `
    import assert from 'node:assert/strict';
    import { extractPdfText } from '../packages/zeroh-disclosure-core/pdf-text.js';
    const result = extractPdfText(${JSON.stringify(file)}, { env: { Path: 'C:\\\\ZEROHFAKE-tools' }, fileExists: () => true });
    assert.equal(result.source, 'built-in');
    assert.match(result.text, /ZEROHFAKE useful document text/);
    process.stdout.write(JSON.stringify({ systemMessage: 'ZEROHFAKE ordinary work continued' }));
  `,
  );
  const result = runHook(project, 'pre-tool-use', {}, {}, plugin);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(
    JSON.parse(result.stdout).systemMessage,
    /ordinary work continued.*subprocess service is unavailable/su,
  );
  assert.ok(!trace(project).some((row) => row.action === 'spawn-with-worker'));
});

test('WIN8 UserPromptSubmit lifecycle header precedes imports', () => {
  const source = readFileSync(
    path.join(PLUGIN, 'hooks/user-prompt-submit.js'),
    'utf8',
  );
  assert.ok(source.indexOf('// Fail closed') < source.indexOf('\nimport '));
});
test('WIN8 uncreatable-home preflight does not turn default ordinary hooks into ACL refusals', () => {
  const project = tempProject();
  const file = path.join(project.dir, 'ZEROHFAKE-file');
  writeFileSync(file, 'ZEROHFAKE');
  for (const [name, event] of [
    ['pre-tool-use', { tool_name: 'Bash', tool_input: { command: 'ls' } }],
    ['user-prompt-submit', { prompt: 'Explain this ordinary code' }],
    ['post-tool-use', { tool_name: 'Bash', tool_response: 'ordinary output' }],
  ]) {
    const result = runHook(project, name, event, {
      ZEROH_HOME: path.join(file, 'zeroh'),
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.doesNotMatch(
      result.stdout,
      /"permissionDecision":"deny"|"decision":"block"|output withheld/iu,
    );
    const ordinary = runHook(project, name, event);
    assert.equal(ordinary.status, 0, ordinary.stderr);
    assert.equal(result.stdout, ordinary.stdout);
  }
});

test('WIN8 recovery after a non-ACL home failure still follows the configured uncertainty mode', () => {
  for (const mode of ['pass', 'block']) {
    const project = tempProject();
    const file = path.join(project.dir, 'ZEROHFAKE-file');
    writeFileSync(file, 'ZEROHFAKE');
    const plugin = copyPlugin(project);
    writeFileSync(
      path.join(plugin, 'hooks/user-prompt-submit.js'),
      `throw Object.assign(new Error('ZEROHFAKE filesystem failure'), { code: 'ENOTDIR' });`,
    );
    const result = runHook(
      project,
      'user-prompt-submit',
      { prompt: 'Explain code' },
      {
        ZEROH_HOME: path.join(file, 'zeroh'),
        ...(mode === 'block' ? { ZEROH_UNCERTAIN: mode } : {}),
      },
      plugin,
    );
    assert.equal(
      result.status,
      mode === 'block' ? 2 : 0,
      result.stderr + result.stdout,
    );
    const answer = JSON.parse(result.stdout);
    assert.equal(answer.decision === 'block', mode === 'block');
    assert.match(result.stdout + result.stderr, /ENOTDIR|could not check/iu);
  }
});
