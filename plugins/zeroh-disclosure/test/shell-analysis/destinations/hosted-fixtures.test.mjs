// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  freshEnvironment,
  shellArguments,
  shellExecutable,
  shellDeadline,
} from './isolation.mjs';
import { runProgramEffects } from './program-effects.mjs';
import {
  executeArgvCase,
  executePowerShellArgvCases,
  requestFixture,
} from './oracles.mjs';
import * as oracleModule from './oracles.mjs';
import * as benchmarkModule from '../parsers/benchmark.mjs';
import { historicalEffects } from './historical-effects.mjs';
import { generateCorpus } from './corpus.mjs';
import { windowsFixtureTool } from './windows-tools.mjs';
import { parsePowerShellCommands } from '../parsers/powershell-adapter.mjs';
import {
  spawnFile,
  spawnFileSync,
  cleanupDirectory,
  captureCommandDiagnostics,
  retryFixtureCleanup,
} from '../parsers/process-files.mjs';

// Process close, job teardown and Windows directory-handle release are separate
// events. Prove every recorded owned PID (including the bridge, watcher and
// console host) is gone before accepting cwd release. The shared wall-clock
// bound catches real leaks and avoids multiplying fixed rm retry windows.
async function releaseTreeCwd(fixture, pids, diagnostics) {
  const started = performance.now();
  const deadline = started + 15000;
  const owned = new Set(pids);
  const observedAlive = new Set();
  const cleanupErrors = new Set();
  let treeGoneAt;
  let live = [];
  let cleanupError;
  do {
    if (diagnostics && existsSync(diagnostics)) {
      for (const file of readdirSync(diagnostics)) {
        const bridgePid = /^bridge-(\d+)\.log$/u.exec(file)?.[1];
        if (bridgePid) owned.add(Number(bridgePid));
        const bytes = readFileSync(path.join(diagnostics, file), 'utf8');
        const log = bytes.slice(0, bytes.lastIndexOf('\n') + 1);
        for (const match of log.matchAll(
          /(?:child started|cleanup watcher ready|child tree) pid=(\d+)/gu,
        ))
          owned.add(Number(match[1]));
      }
    }
    live = [...owned].filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        return false;
      }
    });
    for (const pid of live) observedAlive.add(pid);
    if (live.length) treeGoneAt = undefined;
    if (!live.length) {
      treeGoneAt ??= performance.now();
      try {
        rmSync(fixture.root, { recursive: true, force: true, maxRetries: 0 });
        fixture.cleanup(); // Clear only this root's deferred cleanup entry.
        assert.equal(
          existsSync(fixture.root),
          false,
          'tree termination must release the cwd',
        );
        return {
          observedAlive: [...observedAlive],
          treeExitMs: Math.round(treeGoneAt - started),
          cwdReleaseMs: Math.round(performance.now() - treeGoneAt),
          cleanupErrors: [...cleanupErrors],
        };
      } catch (error) {
        if (!['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(error.code))
          throw error;
        cleanupError = error.code;
        cleanupErrors.add(error.code);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (performance.now() < deadline);
  assert.fail(
    live.length
      ? `owned tree survived cwd-release deadline: PIDs ${live.join(', ')}`
      : `owned tree exited; cwd still locked after 15 s: ${cleanupError}`,
  );
}

test('a locked fixture cleanup is diagnosed without discarding the effect result', async () => {
  const fixture = freshEnvironment('locked-cleanup');
  try {
    const captured = await captureCommandDiagnostics(async () => {
      cleanupDirectory(fixture.root, {
        remove() {
          throw Object.assign(new Error('injected locked directory'), {
            code: 'EPERM',
          });
        },
      });
      return { delivered: true };
    });
    assert.equal(captured.result.delivered, true);
    assert.equal(existsSync(fixture.root), true);
    assert.equal(captured.commands[0].error, 'EPERM');
    assert.deepEqual(retryFixtureCleanup(), []);
    assert.equal(existsSync(fixture.root), false);
  } finally {
    fixture.cleanup();
  }
});

test('cwd release waits for the owned process even when the OS permits deleting its cwd', async () => {
  const fixture = freshEnvironment('live-cwd');
  const child = spawn(
    process.execPath,
    [
      '-e',
      "process.stdout.write('ZEROHFAKE ready'); setInterval(() => {}, 1000);",
    ],
    {
      cwd: fixture.root,
      env: fixture.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  const closed = once(child, 'close');
  let released;
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      closed.then(() => {
        throw new Error('owned cwd child exited before readiness');
      }),
    ]);
    released = releaseTreeCwd(fixture, [child.pid]);
    await new Promise((resolve) => setImmediate(resolve));
    process.kill(child.pid, 0);
    assert.equal(
      existsSync(fixture.root),
      true,
      'live owned process must prevent accepted cleanup',
    );
    child.kill();
    await closed;
    await released;
    assert.equal(existsSync(fixture.root), false);
  } finally {
    if (child.exitCode === null) child.kill();
    await closed;
    await released;
    fixture.cleanup();
  }
});

test(
  '5.1 argv batching isolates scopes, homes, logs and per-case failures',
  { skip: process.platform !== 'win32' },
  async () => {
    const rows = [
      {
        id: 'first',
        command:
          'if ((Get-Command curl).Source -ne [IO.Path]::Combine($env:TMPDIR, "bin", "curl.exe")) { throw "native printer required" }; $caseOnly = "ZEROHFAKEfirst"; function caseOnlyFunction { "ZEROHFAKE" }; Set-Alias caseOnlyAlias Write-Output; $ErrorActionPreference = "Stop"; Set-StrictMode -Version Latest; curl $env:HOME $env:TMPDIR $caseOnly',
      },
      {
        id: 'second',
        command:
          'if ((Get-Command curl).Source -ne [IO.Path]::Combine($env:TMPDIR, "bin", "curl.exe")) { throw "leaked: curl binding" }; if (Get-Command caseOnlyFunction -ErrorAction SilentlyContinue) { throw "leaked: function" }; if (Get-Alias caseOnlyAlias -ErrorAction SilentlyContinue) { throw "leaked: alias" }; if ($ErrorActionPreference -ne "Continue") { throw "leaked: ErrorActionPreference" }; curl $env:HOME $env:TMPDIR $caseOnly',
      },
      {
        id: 'failed',
        command:
          'Write-Error "ZEROHFAKE expected" -ErrorAction SilentlyContinue',
      },
      { id: 'native-failed', command: '& $env:COMSPEC /d /c "exit 7"' },
      { id: 'last', command: 'curl ZEROHFAKElast' },
      { id: 'batch-home', command: 'curl $HOME (Convert-Path ~) $env:HOME' },
    ];
    const batch = await executePowerShellArgvCases(rows, {
      shell: 'powershell-5.1',
      parserCommands: rows.map((row) => row.command),
    });
    assert.equal(
      batch.status,
      0,
      `${batch.stderr}\n${JSON.stringify(batch.observations.map((row) => [row.status, row.calls.length]))}`,
    );
    assert.match(batch.parsed.version, /^5\.1\./u);
    assert.equal(batch.parsed.results.length, rows.length);
    assert.ok(batch.parsed.results.every((row) => row.errors.length === 0));
    const results = batch.observations;
    assert.deepEqual(
      results.map((row) => row.status),
      [0, 0, 1, 1, 0, 0],
    );
    assert.deepEqual(
      results.map((row) => row.calls.length),
      [1, 1, 0, 0, 1, 1],
    );
    const [firstHome, firstTemporary, value] = results[0].calls[0].argv;
    const [secondHome, secondTemporary] = results[1].calls[0].argv;
    assert.equal(value, 'ZEROHFAKEfirst');
    assert.equal(
      results[1].calls[0].argv.length,
      2,
      'case variable must not leak',
    );
    assert.notEqual(firstHome, secondHome);
    assert.notEqual(firstTemporary, secondTemporary);
    assert.equal(path.dirname(firstHome), firstTemporary);
    assert.equal(path.dirname(secondHome), secondTemporary);
    assert.deepEqual(results[4].calls[0].argv, ['ZEROHFAKElast']);
    const [home, tilde, caseHome] = results[5].calls[0].argv;
    assert.equal(home, tilde);
    assert.notEqual(home, caseHome);
    assert.match(home, /ps51-argv-batch-/u);
    assert.match(caseHome, /ps51-argv-case-/u);
    const unbatched = await executeArgvCase(rows[3], {
      shell: 'powershell-5.1',
    });
    assert.equal(
      results[3].status,
      unbatched.status,
      'native exit 7 has the Command exit rule',
    );
  },
);

test('PowerShell argv corpus supplies values as arguments and never requires console stdin', () => {
  const rows = generateCorpus().filter(
    (row) => row.shell === 'powershell' && row.oracle === 'argv',
  );
  assert.ok(rows.length > 0);
  assert.deepEqual(
    rows.filter((row) => row.expected.stdin).map((row) => row.id),
    [],
  );
});

for (const fallback of [false, true])
  test(
    `5.1 reports detached descendants after a normal parent exit (${fallback ? 'PID fallback' : 'job'})`,
    { skip: process.platform !== 'win32' },
    async (t) => {
      const fixture = freshEnvironment('ps51-detached-leak');
      const diagnostics = path.join(fixture.root, 'diagnostics');
      let childPids = [];
      let treeReleased = false;
      try {
        const result = await spawnFile(
          shellExecutable('powershell-5.1'),
          shellArguments(
            'powershell-5.1',
            '$child = Start-Process ([IO.Path]::Combine($env:SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")) -ArgumentList "-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 120" -WorkingDirectory $env:TMPDIR -PassThru; [IO.File]::WriteAllText([IO.Path]::Combine($env:TMPDIR, "child.pid"), ([string]$PID + "," + [string]$child.Id)); exit 0',
          ),
          {
            env: {
              ...fixture.env,
              ZEROH_ORACLE_BRIDGE_DIAGNOSTICS: diagnostics,
              ...(fallback
                ? {
                    ZEROH_ORACLE_FORCE_JOB_FALLBACK: '1',
                    ZEROH_ORACLE_WATCHER_AFTER_ROOT_EXIT: '1',
                  }
                : {}),
            },
            cwd: fixture.root,
            timeout: shellDeadline('powershell-5.1'),
          },
        );
        assert.ok(Number.isInteger(result.status) && result.status !== 0);
        const logs = readdirSync(diagnostics).map((name) =>
          readFileSync(path.join(diagnostics, name), 'utf8'),
        );
        if (fallback)
          assert.ok(
            logs.some((log) =>
              log.includes('root exited before watcher start'),
            ),
            'early-root-exit race was forced',
          );
        assert.ok(
          logs.some((log) => log.includes('child tree leak active=')),
          'real leak must be visible',
        );
        childPids = readFileSync(path.join(fixture.root, 'child.pid'), 'utf8')
          .split(',')
          .map(Number);
        assert.equal(childPids.length, 2, 'child and grandchild must start');
        t.diagnostic(
          `cwd release: ${JSON.stringify(await releaseTreeCwd(fixture, childPids, diagnostics))}`,
        );
        treeReleased = true;
      } finally {
        for (const pid of treeReleased ? [] : childPids) {
          try {
            process.kill(pid);
          } catch {}
        }
        fixture.cleanup();
      }
      assert.equal(
        existsSync(fixture.root),
        false,
        'tree termination must release the cwd',
      );
    },
  );

test('printer setup failure closes HTTP/TLS listeners before the constructor rejects', async () => {
  const listeners = () =>
    process.getActiveResourcesInfo().filter((name) => name === 'TCPServerWrap')
      .length;
  await new Promise((resolve) => setImmediate(resolve));
  const before = listeners();
  await assert.rejects(
    requestFixture({
      installArgvPrinters() {
        throw new Error('injected fixture compiler failure');
      },
    }),
    /injected fixture compiler failure/,
  );
  // libuv can retain closed TCP resources until its next close-callback turn.
  for (let attempt = 0; attempt < 20 && listeners() > before; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(listeners(), before, 'failed setup leaked a listener');
});

test(
  'slow Azure and absent Kubernetes/MySQL clients exercise isolated loopback fixtures',
  {
    skip: process.platform !== 'linux',
  },
  async () => {
    const fixture = freshEnvironment('hosted-client-stubs');
    const originalPath = process.env.PATH;
    const script = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https'),net=require('node:net'),crypto=require('node:crypto');
const args=process.argv.slice(2), program=path.basename(process.argv[1]);
const value=(key)=>args[args.indexOf(key)+1];
if(program==='az') {
  if(!process.env.AZURE_CONFIG_DIR.startsWith(process.env.TMPDIR)||process.env.AZURE_EXTENSION_USE_DYNAMIC_INSTALL!=='no')process.exit(5);
  if(args.includes('--sku.name'))process.exit(2);
  setTimeout(()=>http.get(value('--url'),{headers:{'X-Oracle':value('--headers').split('=')[1]}},res=>{res.resume();res.on('end',()=>process.exit(0));}).on('error',()=>process.exit(3)),11000);
} else if(program==='kubectl'||program==='helm') {
  const config=fs.readFileSync(value('--kubeconfig'),'utf8');
  if(!config.includes('kind: Config')||!config.includes('users: []'))process.exit(2);
  if(program==='kubectl'&&(!value('--cache-dir').startsWith(process.env.TMPDIR)||!args.includes('--request-timeout=5s')))process.exit(5);
  if(program==='helm'&&!['HELM_CONFIG_HOME','HELM_CACHE_HOME','HELM_DATA_HOME','HELM_PLUGINS'].every(key=>process.env[key].startsWith(process.env.TMPDIR)))process.exit(5);
  const target=value(program==='kubectl'?'--server':'--kube-apiserver');
  const token=value(program==='kubectl'?'--token':'--kube-token');
  https.get(target+'/oracle',{rejectUnauthorized:false,headers:{Authorization:'Bearer '+token}},res=>{res.resume();res.on('end',()=>process.exit(0));}).on('error',()=>process.exit(3));
} else {
  if(args.includes('--no-login-paths')||args[0]!=='--no-defaults')process.exit(2);
  const login=process.env.MYSQL_TEST_LOGIN_FILE;
  if(!login||!login.startsWith(process.env.TMPDIR)||fs.existsSync(login))process.exit(3);
  const password=args.find(a=>a.startsWith('--password=')).slice(11);
  const sha1=b=>crypto.createHash('sha1').update(b).digest();
  const stage1=sha1(password),stage2=sha1(stage1),digest=sha1(Buffer.concat([Buffer.from('12345678901234567890'),stage2]));
  const auth=Buffer.from(stage1.map((b,i)=>b^digest[i]));
  const socket=net.connect(Number(value('-P')),value('-h'));
  socket.once('data',()=>{
    const payload=Buffer.concat([Buffer.alloc(32),Buffer.from('fixture\\0'),Buffer.from([auth.length]),auth]);
    const header=Buffer.alloc(4);header.writeUIntLE(payload.length,0,3);header[3]=1;
    socket.write(Buffer.concat([header,payload]));
  });
  socket.once('end',()=>process.exit(1));socket.once('error',()=>process.exit(4));
}
`;
    try {
      for (const name of ['az', 'kubectl', 'helm', 'mysql']) {
        const file = path.join(fixture.bin, name);
        writeFileSync(file, script);
        chmodSync(file, 0o755);
      }
      process.env.PATH = fixture.bin + path.delimiter + originalPath;
      const report = await runProgramEffects();
      for (const program of ['az', 'kubectl', 'helm', 'mysql']) {
        const row = report.results.find((r) => r.program === program);
        assert.equal(
          row?.status,
          'passed',
          `${program}: fixture setup/protocol regression`,
        );
      }
    } finally {
      process.env.PATH = originalPath;
      fixture.cleanup();
    }
  },
);

test(
  'Windows rg executes both obfuscated --pre spellings and changes the protected file',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    const report = await historicalEffects({ shells: ['git-bash'] });
    for (const spelling of ['quoted', 'escaped']) {
      const row = report.results.find((row) =>
        row.id.endsWith(`rg-protected-${spelling}-option`),
      );
      assert.equal(
        row?.status,
        'passed',
        `rg ${spelling}: protected write required`,
      );
    }
    assert.deepEqual(report.failures, [], 'historical effects');
  },
);

test(
  '5.1 transport parses stdin, preserves Unicode/quotes, and reports command exit status',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    const fixture = freshEnvironment('ps51-transport');
    try {
      const executable = shellExecutable('powershell-5.1');
      const diagnostics = path.join(fixture.root, 'diagnostics');
      fixture.env.ZEROH_ORACLE_BRIDGE_DIAGNOSTICS = diagnostics;
      const commands = ["Write-Output 'café'", 'Write-Output "quoted value"'];
      const parsed = parsePowerShellCommands(commands, {
        executable,
        env: fixture.env,
        timeout: shellDeadline('powershell-5.1'),
      });
      assert.match(parsed.version, /^5\.1\./u);
      assert.equal(parsed.results.length, commands.length);
      assert.ok(parsed.results.every((result) => result.errors.length === 0));
      assert.ok(
        parsed.results[0].tokens.some((token) => token.text === "'café'"),
      );
      const parserLogs = readdirSync(diagnostics).map((name) =>
        readFileSync(path.join(diagnostics, name), 'utf8'),
      );
      const inputChars = JSON.stringify({ commands }).length;
      assert.ok(
        parserLogs.some((log) =>
          log.includes(`input decoded chars=${inputChars}`),
        ),
        'parser input must reach the bridge',
      );
      assert.ok(
        parserLogs.some((log) =>
          log.includes(`parser payload ready chars=${inputChars}`),
        ),
        'parser input must reach PowerShell',
      );
      const options = {
        env: fixture.env,
        cwd: fixture.root,
        timeout: shellDeadline('powershell-5.1'),
      };
      const output = await spawnFile(
        executable,
        shellArguments(
          'powershell-5.1',
          '[Console]::WriteLine("café `"quoted`"")',
        ),
        options,
      );
      assert.equal(output.status, 0, 'quoted command exit');
      assert.equal(output.stdout.trim(), 'café "quoted"');
      const failed = await spawnFile(
        executable,
        shellArguments('powershell-5.1', 'exit 7'),
        options,
      );
      assert.equal(failed.status, 7, 'explicit native shell exit status');
      const lastFailure = await spawnFile(
        executable,
        shellArguments(
          'powershell-5.1',
          'Write-Error "ZEROHFAKE expected failure" -ErrorAction SilentlyContinue',
        ),
        options,
      );
      assert.equal(lastFailure.status, 1, 'diagnostics preserve final $?');
      const script = path.join(fixture.root, "script's spaced name.ps1");
      writeFileSync(
        script,
        '\ufeff[Console]::WriteLine("file café")\n',
        'utf8',
      );
      const file = spawnFileSync(
        executable,
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
        ],
        options,
      );
      assert.equal(file.status, 0, 'quoted script path exit');
      assert.equal(file.stdout.trim(), 'file café');
      writeFileSync(script, '\ufeffexit 7\n', 'utf8');
      assert.equal(
        spawnFileSync(executable, ['-File', script], options).status,
        7,
        'script exit status survives the bootstrap',
      );
    } finally {
      fixture.cleanup();
    }
  },
);

for (const fallback of [false, true])
  test(
    `5.1 bridge drains large output and records content-free stages (${fallback ? 'PID fallback' : 'job'})`,
    { skip: process.platform !== 'win32' },
    async () => {
      const fixture = freshEnvironment('ps51-output');
      try {
        const diagnostics = path.join(fixture.root, 'diagnostics');
        const result = await spawnFile(
          shellExecutable('powershell-5.1'),
          shellArguments(
            'powershell-5.1',
            '[Console]::Out.Write(("o" * 131072)); [Console]::Error.Write(("e" * 131072))',
          ),
          {
            env: {
              ...fixture.env,
              ZEROH_ORACLE_BRIDGE_DIAGNOSTICS: diagnostics,
              ...(fallback ? { ZEROH_ORACLE_FORCE_JOB_FALLBACK: '1' } : {}),
            },
            timeout: shellDeadline('powershell-5.1'),
          },
        );
        assert.equal(result.status, 0, 'large-output exit');
        assert.equal(result.stdout, 'o'.repeat(131072));
        assert.equal(result.stderr, 'e'.repeat(131072));
        const logs = readdirSync(diagnostics).map((name) =>
          readFileSync(path.join(diagnostics, name), 'utf8'),
        );
        const bridge = logs.find((log) => log.includes('started argc='));
        assert.ok(
          bridge?.includes('job assigned') ||
            (bridge?.includes('job fallback') &&
              bridge?.includes('cleanup watcher ready')),
          'a cleanup owner is required',
        );
        if (fallback) assert.ok(bridge?.includes('job fallback'));
        for (const stage of [
          'started argc=',
          'input decoded chars=',
          'script written chars=',
          'child started pid=',
          'child stdin closed bytes=0',
          'child exited code=0',
          'output flushed',
        ])
          assert.ok(bridge?.includes(stage), `missing stage: ${stage}`);
        assert.ok(
          logs.some((log) => log.includes('parser payload ready chars=0')),
        );
        for (const index of [0, 1])
          for (const stage of ['before', 'after'])
            assert.ok(
              logs.some((log) =>
                new RegExp(`statement=${index} .* ${stage}`).test(log),
              ),
              `statement ${index} ${stage}`,
            );
        assert.ok(logs.every((log) => !log.includes('[Console]')));
        assert.ok(
          logs.every((log) =>
            log
              .trim()
              .split('\n')
              .every((line) => /^\d{4}-\d{2}-\d{2}T/u.test(line)),
          ),
          'UTC timestamps required',
        );
      } finally {
        fixture.cleanup();
      }
    },
  );

for (const fallback of [false, true])
  test(
    `5.1 child deadline records the descendant tree before cleanup (${fallback ? 'PID fallback' : 'job'})`,
    { skip: process.platform !== 'win32' },
    async () => {
      const fixture = freshEnvironment('ps51-child-deadline');
      const diagnostics = path.join(fixture.root, 'diagnostics');
      try {
        const result = await spawnFile(
          shellExecutable('powershell-5.1'),
          shellArguments(
            'powershell-5.1',
            '$child = Start-Process ([IO.Path]::Combine($env:SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")) -ArgumentList "-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 120" -PassThru; [IO.File]::WriteAllText([IO.Path]::Combine($env:TMPDIR, "descendant.pid"), [string]$child.Id); Start-Sleep -Seconds 120',
          ),
          {
            env: {
              ...fixture.env,
              ZEROH_ORACLE_BRIDGE_DIAGNOSTICS: diagnostics,
              ...(fallback ? { ZEROH_ORACLE_FORCE_JOB_FALLBACK: '1' } : {}),
            },
            timeout: shellDeadline('powershell-5.1'),
          },
        );
        assert.notEqual(
          result.status,
          null,
          'bridge must exit before Node kills it',
        );
        assert.notEqual(result.status, 0, 'child deadline is a failure');
        const logs = readdirSync(diagnostics).map((name) =>
          readFileSync(path.join(diagnostics, name), 'utf8'),
        );
        const bridge = logs.find((log) => log.includes('child timeout'));
        assert.ok(bridge, 'bridge deadline must be visible');
        assert.ok(
          bridge.indexOf('child timeout') < bridge.indexOf('child tree pid='),
          'snapshot follows the timeout',
        );
        // Start-Process creates a console by default. Toolhelp therefore
        // includes its conhost.exe too; no other executable is permitted.
        const tree = [
          ...bridge.matchAll(
            /child tree pid=(\d+) parent=(\d+) program=([^\r\n]+)/gu,
          ),
        ].map((match) => ({
          pid: Number(match[1]),
          parent: Number(match[2]),
          program: match[3],
        }));
        const rootPid = Number(bridge.match(/child started pid=(\d+)/u)[1]);
        const childPid = Number(
          readFileSync(path.join(fixture.root, 'descendant.pid'), 'utf8'),
        );
        assertDescendantSnapshot(tree, rootPid, childPid);
        assert.ok(bridge.includes('tree cleanup exit='));
      } finally {
        fixture.cleanup();
      }
    },
  );

for (const fallback of [false, true])
  test(
    `timing out the 5.1 bridge terminates its child and releases the private cwd (${fallback ? 'PID fallback' : 'job'})`,
    {
      skip: process.platform !== 'win32',
    },
    async (t) => {
      const fixture = freshEnvironment('ps51-timeout');
      if (fallback) fixture.env.ZEROH_ORACLE_FORCE_JOB_FALLBACK = '1';
      const root = fixture.root;
      const diagnostics = path.join(root, 'diagnostics');
      fixture.env.ZEROH_ORACLE_BRIDGE_DIAGNOSTICS = diagnostics;
      let childPids = [];
      let treeReleased = false;
      try {
        const marker = path.join(root, 'child.pid').replaceAll("'", "''");
        const controller = new AbortController();
        const interrupted = spawnFile(
          shellExecutable('powershell-5.1'),
          shellArguments(
            'powershell-5.1',
            `$child = Start-Process ([IO.Path]::Combine($env:SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')) -ArgumentList '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 120' -WorkingDirectory '${root.replaceAll("'", "''")}' -PassThru; [IO.File]::WriteAllText('${marker}', ([string]$PID + ',' + [string]$child.Id)); Start-Sleep -Seconds 120`,
          ),
          // Exercise parent death independently of the bridge's own deadline.
          { env: fixture.env, cwd: root, signal: controller.signal },
        );
        // Attach the rejection assertion immediately, but abort only after the
        // cold process has actually started its descendant.
        const aborted = assert.rejects(interrupted, { code: 'ABORT_ERR' });
        const start = performance.now();
        do {
          if (existsSync(path.join(root, 'child.pid'))) {
            const markerPids = readFileSync(
              path.join(root, 'child.pid'),
              'utf8',
            );
            if (/^[1-9]\d*,[1-9]\d*$/u.test(markerPids)) {
              childPids = markerPids.split(',').map(Number);
              break;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        } while (performance.now() - start < 60000);
        controller.abort();
        await aborted;
        assert.equal(childPids.length, 2, 'child and grandchild must start');
        t.diagnostic(
          `cwd release: ${JSON.stringify(await releaseTreeCwd(fixture, childPids, diagnostics))}`,
        );
        treeReleased = true;
      } finally {
        // Only the PID written by our own child can be killed if the regression fails.
        for (const childPid of treeReleased ? [] : childPids) {
          try {
            process.kill(childPid);
          } catch {}
        }
        fixture.cleanup();
      }
      assert.equal(existsSync(root), false, 'private cwd cleanup');
    },
  );

test(
  'Windows native shell transport preserves quotes, stdin and literal slash arguments',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    for (const shell of ['git-bash', 'pwsh', 'powershell-5.1', 'cmd']) {
      const observed = await executeArgvCase({
        shell,
        command: 'curl "ZEROHFAKE argument" "/literal/path"',
      });
      assert.equal(observed.status, 0, shell);
      assert.deepEqual(
        observed.calls[0]?.argv,
        ['ZEROHFAKE argument', '/literal/path'],
        shell,
      );
    }
    const heredoc = await executeArgvCase({
      shell: 'git-bash',
      command: "curl <<'EOF'\nZEROHFAKE $HOME\nEOF",
    });
    assert.equal(heredoc.status, 0);
    assert.equal(heredoc.calls[0]?.stdin, 'ZEROHFAKE $HOME\n');
  },
);

test(
  '5.1 printer reads pipeline stdin and completes bare native commands',
  { skip: process.platform !== 'win32' },
  async () => {
    const bare = await executeArgvCase({
      shell: 'powershell-5.1',
      command: 'curl "ZEROHFAKE argument"',
    });
    assert.equal(bare.status, 0);
    assert.deepEqual(bare.calls[0]?.argv, ['ZEROHFAKE argument']);
    assert.equal(bare.calls[0]?.stdin, '');
    const piped = await executeArgvCase({
      shell: 'powershell-5.1',
      command: '"ZEROHFAKE stdin" | curl "ZEROHFAKE argument"',
    });
    assert.equal(piped.status, 0);
    assert.deepEqual(piped.calls[0]?.argv, ['ZEROHFAKE argument']);
    assert.equal(piped.calls[0]?.stdin, 'ZEROHFAKE stdin\r\n');
  },
);

test(
  'Windows native printer records UTF-8 bytes from the real file-backed stdin',
  { skip: process.platform !== 'win32' },
  async () => {
    const fixture = freshEnvironment('native-printer-input');
    try {
      const log = path.join(fixture.root, 'argv.jsonl');
      const input = 'ZEROHFAKE café\n"quoted"\n';
      const result = await spawnFile(windowsFixtureTool(), ['ZEROHFAKE argv'], {
        env: { ...fixture.env, ZEROH_ORACLE_LOG: log },
        input,
        timeout: 8000,
      });
      assert.equal(result.status, 0);
      const record = JSON.parse(readFileSync(log, 'utf8'));
      assert.deepEqual(record.argv, ['ZEROHFAKE argv']);
      assert.equal(record.stdin, input);
    } finally {
      fixture.cleanup();
    }
  },
);

// Linux guards complement the real hosted 5.1 regressions; skips prove no Windows behavior.
const bridgeSource = () =>
  readFileSync(new URL('./native-argv.cs', import.meta.url), 'utf8');

test('batched script restores variables, functions, aliases and preferences after each body', () => {
  const source = oracleModule.powerShellArgvScript([
    {
      row: { id: 'first', command: '$caseOnly = 1' },
      fixture: { root: 'ZEROHFAKEroot', env: {} },
      log: 'ZEROHFAKElog',
    },
  ]);
  assert.match(source, /Get-Variable -Scope Script/u);
  assert.match(source, /Get-ChildItem Function:/u);
  assert.match(source, /Get-Alias -Scope Script/u);
  assert.match(source, /finally\s*\{/u);
  assert.match(source, /Remove-Variable.*-Scope Script/u);
  assert.match(source, /Remove-Item -LiteralPath \('Function:' \+/u);
  assert.doesNotMatch(source, /Function:script:/u);
  assert.match(source, /Set-Alias.*-Scope Script/u);
  assert.match(source, /Set-StrictMode -Off/u);
  assert.match(source, /ErrorActionPreference/u);
});

test('batch status matches the unbatched Command boolean exit rule and documents HOME', () => {
  const source = oracleModule.powerShellArgvScript([
    {
      row: { id: 'first', command: 'curl ZEROHFAKE' },
      fixture: { root: 'ZEROHFAKEroot', env: {} },
      log: 'ZEROHFAKElog',
    },
  ]);
  assert.match(
    source,
    /__zerohBatchCaseExit = if \(\$\?\) \{ 0 \} else \{ 1 \}/u,
  );
  assert.doesNotMatch(source, /\$LASTEXITCODE = 0/u);
  assert.match(source, /\$HOME and ~ remain at the batch home/u);
});

test('PID watcher uses a cwd outside the private fixture before acknowledging readiness', () => {
  const source = bridgeSource();
  const watcher = source.slice(
    source.indexOf('private static Process WatchChild'),
    source.indexOf('// The Windows CRT'),
  );
  assert.match(
    watcher,
    /info\.WorkingDirectory = Environment\.GetEnvironmentVariable\("SystemRoot"\)/u,
  );
  assert.ok(
    watcher.indexOf('info.WorkingDirectory') <
      watcher.indexOf('Process.Start(info)'),
  );
});

test('statement instrumentation rejects ParamBlock and UsingStatements before prepending status', () => {
  const source = bridgeSource();
  const instrument = source.slice(
    source.indexOf('private static string Instrument'),
    source.indexOf('private static void PowerShell'),
  );
  assert.match(instrument, /ast\.ParamBlock != null/u);
  assert.match(instrument, /ast\.UsingStatements\.Count != 0/u);
  assert.ok(
    instrument.indexOf('ast.ParamBlock') <
      instrument.indexOf('new StringBuilder(status'),
  );
});

test('cleanup that survives the final retry fails the report while a recovered lock does not', () => {
  const fixture = freshEnvironment('final-cleanup');
  const unrelated = freshEnvironment('other-cleanup');
  const locked = () => {
    throw Object.assign(new Error('locked'), { code: 'EBUSY' });
  };
  try {
    cleanupDirectory(fixture.root, { remove: locked });
    cleanupDirectory(unrelated.root, { remove: locked });
    const report = { failures: [], diagnostics: [] };
    oracleModule.finalizeFixtureCleanup(report, {
      roots: [fixture.root],
      remove: locked,
    });
    assert.equal(report.failures.length, 1);
    assert.match(report.failures[0], /fixture cleanup failed.*EBUSY/u);
    assert.equal(report.diagnostics.length, 1);
    const recovered = { failures: [], diagnostics: [] };
    oracleModule.finalizeFixtureCleanup(recovered, { roots: [fixture.root] });
    assert.deepEqual(recovered.failures, []);
    assert.equal(existsSync(fixture.root), false);
    assert.equal(
      existsSync(unrelated.root),
      true,
      'another test owns its deferred cleanup',
    );
  } finally {
    fixture.cleanup();
    unrelated.cleanup();
  }
});

test('missing adapter marker keeps hook stderr ahead of long metadata and stdout', () => {
  const fixture = freshEnvironment('adapter-marker-error');
  try {
    assert.throws(
      () =>
        benchmarkModule.adapterMarker(path.join(fixture.root, 'absent'), {
          status: 1,
          signal: 'x '.repeat(200),
          stderr: 'ZEROHFAKE hook failed\npassword=ZEROHFAKEvalue',
          stdout: 'x'.repeat(1000),
        }),
      /stderr=ZEROHFAKE hook failed\npassword=\[redacted\]/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test('cleanup margin documentation matches the bounded half-budget reservation', () => {
  const documentation = readFileSync(
    new URL('./ci-effects.md', import.meta.url),
    'utf8',
  );
  assert.match(documentation, /min\(10000, callerTimeout \/ 2\)/u);
  assert.doesNotMatch(documentation, /a four-second\s+cleanup margin/u);
});

function assertDescendantSnapshot(records, rootPid, childPid) {
  assert.equal(
    new Set(records.map((record) => record.pid)).size,
    records.length,
  );
  const powershell = records.filter(
    (record) => record.program.toLowerCase() === 'powershell.exe',
  );
  assert.deepEqual(
    powershell.map((record) => record.pid).sort((a, b) => a - b),
    [rootPid, childPid].sort((a, b) => a - b),
  );
  assert.equal(
    powershell.find((record) => record.pid === childPid).parent,
    rootPid,
  );
  const extra = records.filter(
    (record) => record.program.toLowerCase() !== 'powershell.exe',
  );
  assert.ok(extra.length <= 1, 'at most one new console host');
  for (const record of extra) {
    assert.equal(record.program.toLowerCase(), 'conhost.exe');
    assert.ok(
      [rootPid, childPid].includes(record.parent),
      'console must belong to an owned PowerShell',
    );
  }
}

test('descendant snapshot permits only the two owned PowerShell PIDs and their console host', () => {
  const owned = [
    { pid: 11, parent: 10, program: 'powershell.exe' },
    { pid: 12, parent: 11, program: 'powershell.exe' },
  ];
  assertDescendantSnapshot(owned, 11, 12);
  assertDescendantSnapshot(
    [...owned, { pid: 13, parent: 12, program: 'conhost.exe' }],
    11,
    12,
  );
  for (const extra of [
    { pid: 13, parent: 12, program: 'unexpected.exe' },
    { pid: 13, parent: 999, program: 'conhost.exe' },
    { pid: 13, parent: 12, program: 'powershell.exe' },
  ])
    assert.throws(() => assertDescendantSnapshot([...owned, extra], 11, 12));
  assert.throws(() => assertDescendantSnapshot([owned[0]], 11, 12));
  assert.throws(() => assertDescendantSnapshot(owned, 11, 99));
});

for (const command of [
  'param([string]$value)\nWrite-Output $value',
  'using namespace System\nWrite-Output "ZEROHFAKE"',
])
  test(
    `5.1 diagnostic instrumentation rejects a leading ${command.startsWith('param') ? 'param' : 'using'} block`,
    { skip: process.platform !== 'win32' },
    async () => {
      const fixture = freshEnvironment('unsupported-instrumentation');
      try {
        const diagnostics = path.join(fixture.root, 'diagnostics');
        const result = await spawnFile(
          shellExecutable('powershell-5.1'),
          shellArguments('powershell-5.1', command),
          {
            env: {
              ...fixture.env,
              ZEROH_ORACLE_BRIDGE_DIAGNOSTICS: diagnostics,
            },
            timeout: shellDeadline('powershell-5.1'),
          },
        );
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Fixture body cannot be instrumented/u);
        assert.ok(
          readdirSync(diagnostics).every(
            (name) =>
              !readFileSync(path.join(diagnostics, name), 'utf8').includes(
                'child started pid=',
              ),
          ),
        );
      } finally {
        fixture.cleanup();
      }
    },
  );
