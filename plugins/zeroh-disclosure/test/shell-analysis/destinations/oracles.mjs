// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  spawnFile,
  captureCommandDiagnostics,
  safeDiagnosticText,
  retryFixtureCleanup,
} from '../parsers/process-files.mjs';
import { runParserOracles } from './parser-oracles.mjs';
import { observeCase } from './differential.mjs';
import { wildcardDnsEffects } from './wildcard-dns.mjs';
import { historicalEffects } from './historical-effects.mjs';
import { runProgramEffects } from './program-effects.mjs';
import {
  runResolvedSearchFixture,
  runSshAuthenticatedFixture,
} from './ci-effects.mjs';
import { wrapBashExitStatus } from '../../../packages/shell-analysis/exit-status.js';
import dgram from 'node:dgram';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepareBashLateBinding,
  preparePowerShellLateBinding,
} from '../../../packages/shell-analysis/late-bind.js';
import { generateCorpus, TOKEN, VALUE } from './corpus.mjs';
import { windowsFixtureTool } from './windows-tools.mjs';
import {
  freshEnvironment,
  shellArguments,
  shellExecutable,
  shellKind,
  shellDeadline,
} from './isolation.mjs';

const NETWORK_PROGRAMS = [
  'curl',
  'wget',
  'dig',
  'nslookup',
  'resolvectl',
  'ssh',
  'scp',
  'nc',
  'ncat',
  'openssl',
  'git',
  'gh',
  'az',
  'docker',
  'kubectl',
  'helm',
  'gcloud',
  'aws',
  'psql',
  'redis-cli',
  'mysql',
  'python3',
  'python',
  'node',
  'tar',
  'rg',
  'sort',
  'less',
];
const quote = (s) => {
  const text = String(s);
  const portable = /^[A-Za-z]:\\/u.test(text)
    ? text.replaceAll('\\', '/')
    : text;
  return `'${portable.replaceAll("'", "'\\''")}'`;
};
const psQuote = (s) => `'${String(s).replaceAll("'", "''")}'`;

function bashPrinterPath(fixture) {
  const bin = fixture.bin
    .replaceAll('\\', '/')
    .replace(/^([A-Za-z]):\//u, (_, drive) => `/${drive.toLowerCase()}/`);
  // Pin PATH in the shell too. A launcher PATH rewrite must never fall through
  // to a real network client if runner packaging changes again.
  return `export PATH=${quote(bin)}:"$PATH"; hash -r; case "$(command -v curl)" in ${quote(bin + '/curl')}|${quote(bin + '/curl.exe')}) ;; *) exit 126 ;; esac;\n`;
}

async function invoke(executable, args, fixture, timeout = 12000) {
  try {
    if (/fixture-powershell\.exe$/iu.test(executable))
      timeout = shellDeadline('powershell-5.1', timeout);
    if (
      process.platform === 'win32' &&
      /bash\.exe$/iu.test(executable) &&
      args.includes('-c') &&
      fixture.env.ZEROH_ORACLE_LOG
    ) {
      const index = args.indexOf('-c') + 1;
      args = [...args];
      args[index] = bashPrinterPath(fixture) + args[index];
    }
    if (
      process.platform === 'win32' &&
      /(?:^|[\\/])cmd(?:\.exe)?$/iu.test(executable) &&
      args.includes('/c')
    ) {
      // Node's CRT escaping turns embedded cmd quotes into literal backslashes.
      // A batch file carries source unchanged; /c receives one quoted path.
      const index = args.indexOf('/c');
      if (args.length === index + 2 && !args[index + 1].endsWith('.cmd')) {
        const script = path.join(fixture.root, 'command.cmd');
        writeFileSync(
          script,
          args[index + 1].replace(/\r?\n/gu, '\r\n') + '\r\n',
        );
        args = ['/d', '/s', '/c', `"${script}"`];
      } else args = [...args.slice(0, index + 1), `"${args[index + 1]}"`];
    }
    return await spawnFile(executable, args, {
      cwd: fixture.root,
      env: fixture.env,
      timeout,
      windowsVerbatimArguments:
        process.platform === 'win32' &&
        /(?:^|[\\/])cmd(?:\.exe)?$/iu.test(executable),
    });
  } catch {
    return { status: null, stdout: '', stderr: 'program unavailable' };
  }
}

// Only the controlled argv probes are batched: each body gets its own cwd,
// home, environment and printer log. Native binding and delivery stay real.
// Bodies are dot-sourced after the aliases are removed at script scope: a new
// & scope resurrects Windows PowerShell's AllScope aliases (curl, wget).
export async function executePowerShellArgvCases(
  rows,
  { shell, executables = {}, parserCommands },
) {
  assert.equal(shellKind(shell), 'powershell');
  const batch = freshEnvironment('ps51-argv-batch');
  const cases = [];
  try {
    for (const row of rows) {
      const fixture = freshEnvironment('ps51-argv-case');
      cases.push({ row, fixture, ...installPrinters(fixture) });
    }
    const script = path.join(batch.root, 'cases.ps1');
    let parserSource = '';
    if (parserCommands) {
      const input = path.join(batch.root, 'parser-input.json');
      writeFileSync(input, JSON.stringify({ commands: parserCommands }));
      parserSource = [
        `Set-Location -LiteralPath ${psQuote(batch.root)}`,
        `$env:ZEROH_ORACLE_POWERSHELL_INPUT = ${psQuote(input)}`,
        `. ${psQuote(fileURLToPath(new URL('../parsers/parse.ps1', import.meta.url)))}`,
      ].join('\n');
    }
    writeFileSync(script, powerShellArgvScript(cases, parserSource));
    const result = await invoke(
      shellExecutable(shell, executables),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
      ],
      batch,
      120000,
    );
    const observations = cases.map(({ row, log }) => {
      const records = existsSync(log)
        ? readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(JSON.parse)
        : [];
      const start = records.find((record) => record.program === '__start__');
      const end = records.find((record) => record.program === '__end__');
      return {
        id: row.id,
        status:
          result.status === 0 &&
          start?.argv[0] === row.id &&
          end?.argv[0] === row.id
            ? Number(end.argv[1])
            : null,
        calls: records.filter(
          (record) => !['__start__', '__end__'].includes(record.program),
        ),
      };
    });
    return {
      status: result.status,
      // Bounded and redacted: the reason a whole batch stopped early.
      stderr: safeDiagnosticText(result.stderr),
      observations,
      parsed:
        parserCommands && result.status === 0
          ? JSON.parse(result.stdout.replace(/^\uFEFF/, ''))
          : null,
    };
  } finally {
    for (const { fixture } of cases) fixture.cleanup();
    batch.cleanup();
  }
}

// Dot-sourcing retains 5.1 native binding. Snapshot values (not PSVariable references),
// definitions and alias options so a case cannot contaminate the next one.
// Reserved harness variables are excluded; controlled bodies must not write them.
// The restore runs at script scope, so provider paths stay unqualified: 5.1
// does not resolve a 'Function:script:' path.
export function powerShellArgvScript(cases, parserSource = '') {
  const snapshot = `
$script:__zerohBatchVars = @{}
$script:__zerohBatchFunctions = @{}
$script:__zerohBatchAliases = @{}
foreach ($script:__zerohBatchItem in (Get-Variable -Scope Script)) {
  if (!$script:__zerohBatchItem.Name.StartsWith('__zerohBatch')) {
    $script:__zerohBatchVars[$script:__zerohBatchItem.Name] = @{
      Value = $script:__zerohBatchItem.Value; Options = $script:__zerohBatchItem.Options
    }
  }
}
foreach ($script:__zerohBatchItem in (Get-ChildItem Function:)) {
  $script:__zerohBatchFunctions[$script:__zerohBatchItem.Name] = @{
    Definition = $script:__zerohBatchItem.Definition; Options = $script:__zerohBatchItem.Options
  }
}
foreach ($script:__zerohBatchItem in (Get-Alias -Scope Script)) {
  $script:__zerohBatchAliases[$script:__zerohBatchItem.Name] = @{
    Definition = $script:__zerohBatchItem.Definition; Options = $script:__zerohBatchItem.Options
  }
}`;
  const restore = `
Set-StrictMode -Off
$script:ErrorActionPreference = 'Continue'
foreach ($script:__zerohBatchItem in (Get-Variable -Scope Script)) {
  if (!$script:__zerohBatchItem.Name.StartsWith('__zerohBatch') -and !$script:__zerohBatchVars.ContainsKey($script:__zerohBatchItem.Name)) {
    Remove-Variable -Name $script:__zerohBatchItem.Name -Scope Script -Force
  }
}
foreach ($script:__zerohBatchName in $script:__zerohBatchVars.Keys) {
  if (!($script:__zerohBatchVars[$script:__zerohBatchName].Options -band 3)) {
    Set-Variable -Name $script:__zerohBatchName -Value $script:__zerohBatchVars[$script:__zerohBatchName].Value -Scope Script -Force
  }
}
foreach ($script:__zerohBatchItem in (Get-ChildItem Function:)) {
  if (!$script:__zerohBatchFunctions.ContainsKey($script:__zerohBatchItem.Name)) {
    Remove-Item -LiteralPath ('Function:' + $script:__zerohBatchItem.Name) -Force
  }
}
foreach ($script:__zerohBatchName in $script:__zerohBatchFunctions.Keys) {
  $script:__zerohBatchItem = Get-Item ('Function:' + $script:__zerohBatchName) -ErrorAction SilentlyContinue
  if (!$script:__zerohBatchItem -or $script:__zerohBatchItem.Definition -ne $script:__zerohBatchFunctions[$script:__zerohBatchName].Definition -or $script:__zerohBatchItem.Options -ne $script:__zerohBatchFunctions[$script:__zerohBatchName].Options) {
    Set-Item -LiteralPath ('Function:' + $script:__zerohBatchName) -Value ([scriptblock]::Create($script:__zerohBatchFunctions[$script:__zerohBatchName].Definition)) -Options $script:__zerohBatchFunctions[$script:__zerohBatchName].Options -Force
  }
}
foreach ($script:__zerohBatchItem in (Get-Alias -Scope Script)) {
  if (!$script:__zerohBatchAliases.ContainsKey($script:__zerohBatchItem.Name)) {
    Remove-Item -LiteralPath ('Alias:' + $script:__zerohBatchItem.Name) -Force
  }
}
foreach ($script:__zerohBatchName in $script:__zerohBatchAliases.Keys) {
  Set-Alias -Name $script:__zerohBatchName -Value $script:__zerohBatchAliases[$script:__zerohBatchName].Definition -Option $script:__zerohBatchAliases[$script:__zerohBatchName].Options -Scope Script -Force
}`;
  return (
    '\uFEFF' +
    powershellPrinters() +
    '\n' +
    // These process-start automatic values cannot follow per-case env changes.
    '# $HOME and ~ remain at the batch home; per-case paths use $env:HOME.\n' +
    "$script:ErrorActionPreference = 'Continue'\nSet-StrictMode -Off\n" +
    cases
      .map(({ row, fixture, log }) => {
        const marker = (tag, status) =>
          `[IO.File]::AppendAllText(${psQuote(log)}, ('{"program":"${tag}","argv":["${row.id}","' + ${status} + '"]}' + [Environment]::NewLine))`;
        return [
          ...Object.entries(fixture.env).map(
            ([key, value]) =>
              `[Environment]::SetEnvironmentVariable(${psQuote(key)}, ${psQuote(value)}, 'Process')`,
          ),
          `Set-Location -LiteralPath ${psQuote(fixture.root)}`,
          snapshot,
          marker('__start__', '0'),
          // -Command in the unbatched bridge maps final $? to 0/1, including
          // nonzero native exits. Reset only the real global native status.
          'try {\n. {\n$global:LASTEXITCODE = 0\n' +
            row.command +
            '\n$script:__zerohBatchCaseExit = if ($?) { 0 } else { 1 }\n}\n} finally {\n' +
            restore +
            '\n}',
          marker('__end__', '$script:__zerohBatchCaseExit'),
        ].join('\n');
      })
      .join('\n') +
    '\n' +
    parserSource +
    '\nexit 0\n'
  );
}

function installPrinters(fixture) {
  const printer = path.join(fixture.root, 'argv-printer.cjs');
  const log = path.join(fixture.root, 'argv.jsonl');
  if (process.platform === 'win32') {
    fixture.env.ZEROH_ORACLE_LOG = log;
    const native = windowsFixtureTool();
    for (const program of NETWORK_PROGRAMS)
      copyFileSync(native, path.join(fixture.bin, `${program}.exe`));
    return { log, printer: native };
  }
  writeFileSync(
    printer,
    `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({program:process.argv[2],argv:process.argv.slice(3),stdin:fs.readFileSync(0,'utf8')})+'\\n');`,
  );
  for (const program of NETWORK_PROGRAMS) {
    const target = path.join(fixture.bin, program);
    writeFileSync(
      target,
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(printer)} ${quote(program)} "$@"\n`,
    );
    chmodSync(target, 0o700);
    writeFileSync(
      `${target}.cmd`,
      `@"${process.execPath}" "${printer}" "${program}" %*\r\n`,
    );
  }
  return { log, printer };
}

function powershellPrinters() {
  // Keep native executable binding; neither functions nor batch wrappers prove
  // Windows argv. Windows printers are locally compiled console executables.
  return (
    NETWORK_PROGRAMS.map(
      (name) =>
        `Remove-Item Alias:global:${name} -Force -ErrorAction SilentlyContinue; Remove-Item Alias:${name} -Force -ErrorAction SilentlyContinue`,
    ).join('; ') + '; '
  );
}

export async function executeArgvCase(
  row,
  { shell = row.shell, executables = {} } = {},
) {
  const fixture = freshEnvironment('argv');
  try {
    const { log, printer } = installPrinters(fixture);
    let command = row.command;
    if (['pwsh', 'powershell'].includes(shellKind(shell)))
      command = powershellPrinters(printer) + command;
    const result = await invoke(
      shellExecutable(shell, executables),
      shellArguments(shell, command),
      fixture,
    );
    return {
      status: result.status,
      calls: existsSync(log)
        ? readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((s) => JSON.parse(s))
        : [],
    };
  } finally {
    fixture.cleanup();
  }
}

export async function runCorpusArgvOracle(shell, executables = {}) {
  const kind = shellKind(shell);
  const rows = generateCorpus().filter(
    (row) => row.shell === kind && row.oracle === 'argv',
  );
  if (!rows.length)
    throw new Error('required shell has no generated argv corpus');
  const fixture = freshEnvironment('corpus-argv');
  try {
    const { log, printer } = installPrinters(fixture);
    const ps = kind === 'pwsh' || kind === 'powershell';
    const marker = (tag, id, end = false) =>
      ps
        ? `[IO.File]::AppendAllText(${psQuote(log)}, ('{"program":"${tag}","argv":["${id}","' + ${end ? '$LASTEXITCODE' : '0'} + '"]}' + [Environment]::NewLine))`
        : kind === 'cmd'
          ? `"${printer}" --zeroh-marker "${tag}" "${id}" ${end ? '%errorlevel%' : '0'}`
          : `printf '%s\\n' ${quote(`{"program":"${tag}","argv":["${id}","`)}"${end ? '$?' : '0'}"${quote('"]}')} >> ${quote(log)}`;
    const commands = rows
      .map((row) =>
        [
          marker('__start__', row.id),
          row.command.replaceAll(TOKEN, VALUE),
          marker('__end__', row.id, true),
        ].join('\n'),
      )
      .join('\n');
    const script = path.join(
      fixture.root,
      ps ? 'corpus.ps1' : kind === 'cmd' ? 'corpus.cmd' : 'corpus.sh',
    );
    writeFileSync(
      script,
      kind === 'cmd'
        ? commands.replace(/\r?\n/gu, '\r\n') + '\r\n'
        : (ps
            ? powershellPrinters(printer)
            : process.platform === 'win32' && kind === 'bash'
              ? bashPrinterPath(fixture)
              : '') +
            commands +
            '\n',
    );
    const args = ps
      ? [
          '-NoProfile',
          '-NonInteractive',
          ...(kind === 'powershell' ? ['-ExecutionPolicy', 'Bypass'] : []),
          '-File',
          script,
        ]
      : kind === 'cmd'
        ? ['/d', '/c', script]
        : kind === 'zsh'
          ? ['-f', script]
          : ['--noprofile', '--norc', script];
    const result = await invoke(
      shellExecutable(shell, executables),
      args,
      fixture,
      120000,
    );
    const records = existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    const observations = [];
    let current = null;
    for (const record of records) {
      if (record.program === '__start__')
        current = { id: record.argv[0], calls: [] };
      else if (record.program === '__end__' && current) {
        const row = rows.find((r) => r.id === current.id);
        const calls = current.calls;
        const status = Number(record.argv[1] || 0);
        const expected = row.expected.argv.map((arg) =>
          arg.replaceAll(TOKEN, VALUE),
        );
        const noCall = row.category === 'redirect-file';
        const argvCorrect = noCall
          ? calls.length === 0
          : calls.length === 1 &&
            JSON.stringify(calls[0].argv) === JSON.stringify(expected);
        const stdinCorrect =
          noCall ||
          (calls.length === 1 &&
            calls[0].stdin ===
              (row.expected.stdin || '').replaceAll(TOKEN, VALUE));
        observations.push({
          id: row.id,
          status,
          argvCorrect,
          stdinCorrect,
          valuePresent: calls.some(
            (c) =>
              c.argv.some((arg) => arg.includes(VALUE)) ||
              c.stdin.includes(VALUE),
          ),
          proof:
            'real-shell-argv; program delivery requires independent client fixture',
        });
        current = null;
      } else if (current) current.calls.push(record);
    }
    return {
      shell,
      count: rows.length,
      observed: observations.length,
      status: result.status,
      observations,
      failures: observations
        .filter(
          (row) => row.status !== 0 || !row.argvCorrect || !row.stdinCorrect,
        )
        .map((row) => row.id),
      complete: observations.length === rows.length,
    };
  } finally {
    fixture.cleanup();
  }
}

function argvRows(shell) {
  const kind = shellKind(shell);
  if (kind === 'cmd')
    return [
      {
        id: 'cmd-double',
        command: 'curl "ZEROHFAKE argument"',
        expected: ['ZEROHFAKE argument'],
      },
      {
        id: 'cmd-escape',
        command: 'curl ZEROHFAKE^&value',
        expected: ['ZEROHFAKE&value'],
      },
    ];
  if (kind === 'pwsh' || kind === 'powershell')
    return [
      {
        id: 'ps-string-stop',
        command: "curl 'X: --% ZEROHFAKEvalue'",
        expected: ['X: --% ZEROHFAKEvalue'],
      },
      {
        id: 'ps-comment-stop',
        command: '# --%\ncurl ZEROHFAKEvalue',
        expected: ['ZEROHFAKEvalue'],
      },
      {
        id: 'ps-reference-suffix',
        command:
          "$STRIPE_KEY='ZEROHFAKEfirst'; $STRIPE_KEY_SUFFIX='ZEROHFAKEsecond'; curl $STRIPE_KEY_SUFFIX",
        expected: ['ZEROHFAKEsecond'],
      },
      {
        id: 'ps-reference-boundary',
        command: '$STRIPE_KEY=\'ZEROHFAKEfirst\'; curl "${STRIPE_KEY}_SUFFIX"',
        expected: ['ZEROHFAKEfirst_SUFFIX'],
      },
      {
        id: 'ps-here-string',
        command: "curl @'\nZEROHFAKEvalue\n'@",
        expected: ['ZEROHFAKEvalue'],
      },
    ];
  return [
    {
      id: 'single',
      command: "curl 'ZEROHFAKE value'",
      expected: ['ZEROHFAKE value'],
    },
    {
      id: 'double',
      command: 'curl "ZEROHFAKE value"',
      expected: ['ZEROHFAKE value'],
    },
    {
      id: 'ansi-c',
      command: "curl $'ZEROHFAKE\\tvalue'",
      expected: ['ZEROHFAKE\tvalue'],
    },
    {
      id: 'escaped',
      command: 'curl ZEROHFAKE\\ value',
      expected: ['ZEROHFAKE value'],
    },
    {
      id: 'concat',
      command: 'curl ZEROH\'FAKE\'"value"',
      expected: ['ZEROHFAKEvalue'],
    },
    {
      id: 'comment',
      command: 'curl ZEROHFAKEvalue # ignored',
      expected: ['ZEROHFAKEvalue'],
    },
    {
      id: 'substitution',
      command: 'curl "$(printf %s ZEROHFAKEvalue)"',
      expected: ['ZEROHFAKEvalue'],
    },
    {
      id: 'heredoc-quoted',
      command: "curl <<'EOF'\nZEROHFAKE $HOME\nEOF",
      expected: [],
      stdin: 'ZEROHFAKE $HOME\n',
    },
    {
      id: 'heredoc-unquoted',
      command: 'x=ZEROHFAKEvalue; curl <<EOF\n$x\nEOF',
      expected: [],
      stdin: 'ZEROHFAKEvalue\n',
    },
    {
      id: 'array-origin',
      command: 'a=(ZEROHFAKEfirst ZEROHFAKEsecond); curl "${a[1]}"',
      expected: [kind === 'zsh' ? 'ZEROHFAKEfirst' : 'ZEROHFAKEsecond'],
    },
  ];
}

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
const close = (server) => new Promise((resolve) => server.close(resolve));

// This is a separate real-client oracle: it observes received bytes, not a
// host guessed from argv. The wrapper pins every connection to loopback and
// disables proxies, DNS and all default curl configuration unless tested.
export async function requestFixture({
  installArgvPrinters = installPrinters,
} = {}) {
  const fixture = freshEnvironment('requests');
  const requests = [];
  const record = (req, res) => {
    let body = '';
    req.on('data', (data) => {
      body += data;
    });
    req.on('end', () => {
      requests.push({
        host: req.headers.host,
        path: req.url,
        body,
        headers: req.headers,
      });
      if (req.url === '/redirect') {
        res.writeHead(307, {
          Location: `http://evil.example.com:${httpServer.address().port}/received`,
        });
      }
      res.end('ok');
    });
  };
  const httpServer = http.createServer(record);
  try {
    await listen(httpServer);
  } catch {
    fixture.cleanup();
    throw new Error('Loopback HTTP fixture unavailable');
  }
  const key = path.join(fixture.root, 'key.pem');
  const cert = path.join(fixture.root, 'cert.pem');
  const certificate = await invoke(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-subj',
      '/CN=fixture.example.com',
      '-days',
      '1',
    ],
    fixture,
  );
  if (certificate.status !== 0) {
    await close(httpServer);
    fixture.cleanup();
    throw new Error('TLS fixture certificate generation failed');
  }
  const tlsServer = https.createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    record,
  );
  try {
    await listen(tlsServer);
  } catch {
    await close(httpServer);
    fixture.cleanup();
    throw new Error('Loopback TLS fixture unavailable');
  }
  const hp = httpServer.address().port,
    tp = tlsServer.address().port;
  const foundCurl = spawnSync(
    process.platform === 'win32' ? 'where.exe' : 'which',
    [process.platform === 'win32' ? 'curl.exe' : 'curl'],
    {
      env: fixture.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const curl = (foundCurl.stdout || '').trim().split(/\r?\n/u)[0];
  if (!curl) {
    await close(httpServer);
    await close(tlsServer);
    fixture.cleanup();
    throw new Error('real curl is required');
  }
  try {
    installArgvPrinters(fixture);
    const wrapper = path.join(fixture.bin, 'curl');
    const pinned = [
      '--proxy',
      '',
      '--noproxy',
      '*',
      '--max-time',
      '4',
      '--silent',
      '--show-error',
      '--insecure',
      '--resolve',
      `allowed.example.com:${hp}:127.0.0.1`,
      '--resolve',
      `evil.example.com:${hp}:127.0.0.1`,
      '--resolve',
      `fixture.example.com:${tp}:127.0.0.1`,
    ];
    if (process.platform === 'win32') {
      // The same native executable forwards curl with pinned loopback arguments.
      // No .cmd wrapper introduces a second parse of data arguments.
      fixture.env.ZEROH_ORACLE_REAL_CURL = curl;
      fixture.env.ZEROH_ORACLE_CURL_ARGS = JSON.stringify(['-q', ...pinned]);
    } else {
      writeFileSync(
        wrapper,
        `#!/bin/sh\nexec ${quote(curl)} -q ${pinned.map(quote).join(' ')} "$@"\n`,
      );
      chmodSync(wrapper, 0o700);
    }
    // PowerShell uses the wrapper by its full path, avoiding Windows' curl alias.
    return {
      fixture,
      requests,
      hp,
      tp,
      curl,
      pinned,
      async cleanup() {
        await close(httpServer);
        await close(tlsServer);
        fixture.cleanup();
      },
    };
  } catch (error) {
    // Constructor failures never return a request object to oracle finally.
    // Without this cleanup, a compiler error leaves both listeners alive.
    await close(httpServer);
    await close(tlsServer);
    fixture.cleanup();
    throw error;
  }
}

async function restoration(shell, executables, request) {
  const kind = shellKind(shell);
  if (kind === 'cmd')
    return {
      supported: false,
      reason:
        'cmd has no late-binding wrapper in 1.0; CI must verify the notice fallback',
    };
  const fixture = request.fixture;
  const ps = kind === 'pwsh' || kind === 'powershell';
  const command = ps
    ? process.platform === 'win32'
      ? // 5.1 drops empty native arguments, including the pinned --proxy ''.
        // The native wrapper supplies those arguments directly with CRT quoting.
        `& ${psQuote(path.join(fixture.bin, 'curl.exe'))} -d '${TOKEN}' 'http://allowed.example.com:${request.hp}/restore'`
      : `& ${psQuote(request.curl)} -q ${request.pinned.map(psQuote).join(' ')} -d '${TOKEN}' 'http://allowed.example.com:${request.hp}/restore'`
    : `curl -q -d '${TOKEN}' http://allowed.example.com:${request.hp}/restore`;
  const prepared = (ps ? preparePowerShellLateBinding : prepareBashLateBinding)(
    {
      command,
      vault: {
        entryOf: (token) =>
          token === TOKEN
            ? { type: 'API_KEY', value: VALUE, source: 'known:ORACLE' }
            : null,
      },
      sessionId: 'oracle',
      toolUseId: shell,
      home: fixture.env.ZEROH_HOME,
    },
  );
  assert.equal(prepared.ok, true, `${shell}: restoration preparation failed`);
  assert.equal(
    prepared.command.includes(VALUE),
    false,
    `${shell}: inline restored value`,
  );
  const before = request.requests.length;
  const result = await invoke(
    shellExecutable(shell, executables),
    shellArguments(
      shell,
      ps
        ? prepared.command
        : wrapBashExitStatus(prepared.command, { original: command }),
    ),
    fixture,
  );
  assert.equal(result.status, 0, `${shell}: restoration shell failed`);
  const received = request.requests.slice(before);
  assert.equal(received.length, 1, `${shell}: restoration request count`);
  assert.equal(received[0].body, VALUE, `${shell}: restored bytes mismatch`);
  assert.match(received[0].host, /^allowed\.example\.com:/u);
  assert.ok(prepared.file, `${shell}: values file was not created`);
  assert.equal(
    existsSync(prepared.file),
    false,
    `${shell}: values file cleanup`,
  );
  let hook, nonzeroReported;
  if (!ps) {
    const failingCommand = command + '\nfalse';
    const failing = prepareBashLateBinding({
      command: failingCommand,
      vault: {
        entryOf: (token) =>
          token === TOKEN
            ? { type: 'API_KEY', value: VALUE, source: 'known:ORACLE' }
            : null,
      },
      sessionId: 'oracle',
      toolUseId: shell + '-failure',
      home: fixture.env.ZEROH_HOME,
    });
    assert.equal(failing.ok, true, 'failure restoration preparation');
    const start = request.requests.length;
    const failed = await invoke(
      shellExecutable(shell, executables),
      shellArguments(
        shell,
        wrapBashExitStatus(failing.command, { original: failingCommand }),
      ),
      fixture,
    );
    assert.equal(
      failed.status,
      0,
      'exit-status wrapper did not mask failure exit',
    );
    assert.ok(
      failed.stdout.includes('[ZeroH: exit status 1]'),
      'nonzero status was not reported',
    );
    assert.equal(
      request.requests.slice(start)[0]?.body,
      VALUE,
      'failing command restoration delivery',
    );
    assert.equal(
      existsSync(failing.file),
      false,
      'failing command values cleanup',
    );
    nonzeroReported = true;

    hook = await observeCase(
      {
        id: `loopback-hook-${shell}`,
        shell,
        program: 'curl',
        spelling: '-d',
        command,
        allowedHosts: ['allowed.example.com'],
        expected: {
          hosts: ['allowed.example.com'],
          effect: 'data',
          outcome: 'allow',
        },
      },
      {
        executeHook: async ({ command: updated, env, cwd }) => {
          const start = request.requests.length;
          const result = await spawnFile(
            shellExecutable(shell, executables),
            shellArguments(
              shell,
              process.platform === 'win32'
                ? bashPrinterPath(request.fixture) + updated
                : updated,
            ),
            {
              cwd,
              env: {
                ...env,
                PATH: request.fixture.bin + path.delimiter + env.PATH,
                ...(process.platform === 'win32'
                  ? {
                      ZEROH_ORACLE_REAL_CURL: request.curl,
                      ZEROH_ORACLE_CURL_ARGS: JSON.stringify([
                        '-q',
                        ...request.pinned,
                      ]),
                    }
                  : {}),
              },
              timeout: 12000,
            },
          );
          const records = request.requests.slice(start);
          assert.equal(result.status, 0, 'hook restoration shell exit');
          assert.equal(records.length, 1, 'hook restoration delivery count');
          assert.equal(
            records[0].body,
            VALUE,
            'hook restoration delivered bytes',
          );
          return { delivered: true, exitStatus: result.status };
        },
      },
    );
    assert.equal(
      hook.outcome,
      'allow',
      'hook should allow independently allowed destination',
    );
    assert.equal(
      hook.executionEffect?.delivered,
      true,
      'actual hook restoration not executed',
    );
    const denied = await observeCase({
      id: `loopback-deny-${shell}`,
      shell,
      program: 'curl',
      spelling: '-d',
      command: command.replaceAll('allowed.example.com', 'evil.example.com'),
      expected: {
        hosts: ['evil.example.com'],
        effect: 'data',
        outcome: 'deny',
      },
    });
    assert.equal(
      denied.outcome,
      'deny',
      'hook should deny unallowed destination',
    );
    const noticed = await observeCase({
      id: `loopback-notice-${shell}`,
      shell,
      program: 'curl',
      spelling: '-K',
      command: command.replace('curl -q', 'curl -q -K./curlrc'),
      allowedHosts: ['allowed.example.com'],
      fixtures: { files: { curlrc: 'header = "X-Oracle: ZEROHFAKEconfig"\n' } },
      expected: {
        hosts: ['allowed.example.com'],
        effect: 'config-file',
        outcome: 'notice',
      },
    });
    assert.equal(
      noticed.outcome,
      'notice',
      'uncertain config must disclose restoration status',
    );
    assert.equal(noticed.receipt, true, 'config notice must have a receipt');
    hook = {
      allowed: hook.outcome,
      denied: denied.outcome,
      delivered: hook.executionEffect.delivered,
      notice: noticed.outcome,
      receipt: noticed.receipt,
    };
  }
  return {
    hook,
    nonzeroReported,
    exitStatusWrapper: !ps,
    supported: true,
    delivered: true,
    exitStatus: result.status,
    valuesFileRemoved: true,
  };
}

async function httpEffects(request) {
  const { fixture, curl, hp, tp, requests, pinned } = request;
  const run = async (args) => {
    const before = requests.length;
    const result = await invoke(
      curl,
      args[0] === '-q'
        ? ['-q', ...pinned, ...args.slice(1)]
        : [...pinned, ...args],
      fixture,
    );
    assert.equal(result.status, 0, 'loopback curl failed');
    return requests.slice(before);
  };
  const config = path.join(fixture.root, 'curlrc');
  writeFileSync(config, `data = "${VALUE}"\nheader = "X-Oracle: ${VALUE}"\n`);
  const configured = await run([
    '-q',
    '-K',
    config,
    '--trace-ascii',
    path.join(fixture.root, 'trace.txt'),
    `http://allowed.example.com:${hp}/config`,
  ]);
  assert.equal(configured[0].body, VALUE);
  assert.equal(configured[0].headers['x-oracle'], VALUE);
  assert.equal(
    readFileSync(path.join(fixture.root, 'trace.txt'), 'utf8').includes(VALUE),
    true,
  );
  writeFileSync(path.join(fixture.env.HOME, '.curlrc'), `data = "${VALUE}"\n`);
  const defaultConfig = await run([`http://allowed.example.com:${hp}/default`]);
  const disabledConfig = await run([
    '-q',
    `http://allowed.example.com:${hp}/disabled`,
  ]);
  assert.equal(defaultConfig[0].body, VALUE);
  assert.equal(disabledConfig[0].body, '');
  const redirects = await run([
    '-q',
    '-L',
    '-d',
    VALUE,
    `http://allowed.example.com:${hp}/redirect`,
  ]);
  assert.deepEqual(
    redirects.map((r) => r.host.split(':')[0]),
    ['allowed.example.com', 'evil.example.com'],
  );
  assert.equal(
    redirects.every((r) => r.body === VALUE),
    true,
  );
  const tls = await run([
    '-q',
    '-d',
    VALUE,
    `https://fixture.example.com:${tp}/tls`,
  ]);
  assert.equal(tls[0].body, VALUE);
  // Curl's comma-separated multi-address --resolve tries a refused address
  // then the fixture. Neither address leaves the loopback range.
  const multi = await run([
    '-q',
    '--resolve',
    `multi.example.com:${hp}:127.0.0.2,127.0.0.1`,
    '-d',
    VALUE,
    `http://multi.example.com:${hp}/multi`,
  ]);
  assert.equal(multi[0].body, VALUE);
  return {
    config: true,
    defaultConfig: true,
    qDisablesDefault: true,
    crossHostRedirect: true,
    tls: true,
    multiAddress: true,
  };
}

function dnsName(packet, offset = 12) {
  const labels = [];
  while (packet[offset] && offset < packet.length) {
    const n = packet[offset++];
    labels.push(packet.subarray(offset, offset + n).toString('ascii'));
    offset += n;
  }
  return { name: labels.join('.'), end: offset + 1 };
}

async function dnsEffects() {
  const fixture = freshEnvironment('dns');
  const queries = [];
  const socket = dgram.createSocket('udp4');
  socket.on('message', (packet, peer) => {
    const query = dnsName(packet);
    queries.push({ name: query.name, packet });
    const response = Buffer.from(packet.subarray(0, query.end + 4));
    response.writeUInt16BE(0x8183, 2); // NXDOMAIN, echo question, no records.
    response.writeUInt16BE(0, 6);
    response.writeUInt16BE(0, 8);
    response.writeUInt16BE(0, 10);
    socket.send(response, peer.port, peer.address);
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, '127.0.0.1', () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });
  } catch {
    try {
      socket.close();
    } catch {
      // A denied bind may already have closed the socket.
    }
    fixture.cleanup();
    throw new Error('DNS loopback fixture unavailable');
  }
  const port = socket.address().port;
  const run = async (program, args, expected) => {
    const before = queries.length;
    const result = await invoke(program, args, fixture);
    const received = queries.slice(before);
    assert.equal(
      received.some((q) => q.name.toLowerCase() === expected.toLowerCase()),
      true,
      `${program}: composed DNS name not delivered`,
    );
    return received;
  };
  try {
    const suffix = `${VALUE}.example.com`;
    await run(
      'dig',
      [
        '@127.0.0.1',
        '-p',
        String(port),
        '+time=1',
        '+tries=1',
        `+domain=${suffix}`,
        '+search',
        'probe',
      ],
      `probe.${suffix}`,
    );
    await run(
      'nslookup',
      [
        `-port=${port}`,
        '-timeout=1',
        '-retry=1',
        '-search',
        `-domain=${suffix}`,
        'probe',
        '127.0.0.1',
      ],
      `probe.${suffix}`,
    );
    const beforeList = queries.length;
    const listResult = await invoke(
      'nslookup',
      [
        `-port=${port}`,
        '-timeout=1',
        '-retry=1',
        '-search',
        `-srchlist=${suffix}`,
        'probe',
        '127.0.0.1',
      ],
      fixture,
    );
    const listQueries = queries.slice(beforeList);
    const listRejected = /Invalid option: srchlist=/u.test(
      listResult.stdout + listResult.stderr,
    );
    assert.equal(
      listRejected ||
        listQueries.some(
          (q) => q.name.toLowerCase() === `probe.${suffix}`.toLowerCase(),
        ),
      true,
      'nslookup search-list has neither a composed query nor a program rejection',
    );
    const localSecret = Buffer.from('ZEROHFAKEsigningmaterial').toString(
      'base64',
    );
    const tsig = await run(
      'dig',
      [
        '@127.0.0.1',
        '-p',
        String(port),
        '+time=1',
        '+tries=1',
        '-y',
        `hmac-sha256:keyname:${localSecret}`,
        'example.com',
      ],
      'example.com',
    );
    assert.equal(
      tsig.every(
        (q) =>
          !q.packet.includes(Buffer.from('ZEROHFAKEsigningmaterial')) &&
          !q.packet.includes(Buffer.from(localSecret)),
      ),
      true,
      'TSIG key material transmitted',
    );
    const named = await run(
      'dig',
      [
        '@127.0.0.1',
        '-p',
        String(port),
        '+time=1',
        '+tries=1',
        '-y',
        `hmac-sha256:${VALUE}:${localSecret}`,
        'example.com',
      ],
      'example.com',
    );
    assert.equal(
      named.some((q) => q.packet.includes(Buffer.from(VALUE.toLowerCase()))),
      true,
      'TSIG key name absent from wire',
    );
    await run(
      'dig',
      [
        '@127.0.0.1',
        '-p',
        String(port),
        '+time=1',
        '+tries=1',
        '-y',
        `hmac-sha256:keyname:${localSecret}`,
        `${VALUE}.example.com`,
      ],
      `${VALUE}.example.com`,
    );
    return {
      digSearch: true,
      nslookupDomain: true,
      nslookupSearchList: listRejected
        ? 'program-rejected: installed BIND nslookup does not accept -srchlist'
        : true,
      tsigSecretLocal: true,
      tsigNameDelivered: true,
      tsigQueryDelivered: true,
      resolvectl: 'requires a CI systemd-resolved fixture; not run here',
    };
  } finally {
    socket.close();
    fixture.cleanup();
  }
}

export function finalizeFixtureCleanup(report, options) {
  for (const command of retryFixtureCleanup(options)) {
    report.failures.push(`fixture cleanup failed: ${command.stderr}`);
    report.diagnostics.push({
      oracle: 'cleanup',
      shell: 'fixture',
      caseIds: [],
      message: command.stderr,
      commands: [command],
    });
  }
}

export async function runDestinationOracles({
  shells = ['bash'],
  executables = {},
  onStage = () => {},
} = {}) {
  const report = {
    platform: process.platform,
    node: process.versions.node,
    shells: [],
    requests: {},
    failures: [],
    oracleRequirementsChecked: true,
    diagnostics: [],
    pending: [],
  };
  // Capture command stderr inside each oracle scope, without argv, stdout or env.
  const attempt = async (oracle, shell, caseIds, run) => {
    const captured = await captureCommandDiagnostics(run);
    for (const command of captured.commands.filter(
      (command) => command.program === 'fixture-cleanup',
    ))
      report.diagnostics.push({
        oracle: 'cleanup',
        shell,
        caseIds,
        message: command.stderr,
        commands: [command],
      });
    const failures = [
      ...(captured.result?.failures ?? []),
      ...(captured.result?.disagreements ?? []).map((row) => row.id),
    ];
    const failed =
      captured.error ||
      failures.length ||
      captured.result?.complete === false ||
      captured.result?.status === null ||
      (typeof captured.result?.status === 'number' &&
        captured.result.status !== 0);
    if (failed) {
      const ids = caseIds.length
        ? caseIds
        : failures.map((reason) => reason.split(':')[0]);
      if (captured.result?.diagnostics?.length)
        report.diagnostics.push(...captured.result.diagnostics);
      else
        report.diagnostics.push({
          oracle,
          shell,
          caseIds: ids.length ? ids : [oracle],
          message: safeDiagnosticText(
            captured.error?.message ?? failures.join('; '),
          ),
          commands: [
            ...captured.commands,
            ...(captured.error?.oracleCommands ?? []),
          ].slice(-10),
        });
    }
    if (captured.error) throw captured.error;
    return captured.result;
  };
  const checkpoint = (stage) => {
    onStage(stage);
    if (process.env.ZEROH_ORACLE_CHECKPOINT)
      writeFileSync(process.env.ZEROH_ORACLE_CHECKPOINT, stage);
  };
  let request;
  checkpoint('listeners');
  try {
    request = await attempt(
      'listeners',
      'node',
      ['http', 'tls'],
      requestFixture,
    );
  } catch {
    report.failures.push('HTTP/TLS loopback fixture unavailable');
  }
  try {
    if (request) {
      checkpoint('http');
      try {
        report.requests = await attempt(
          'http',
          'curl',
          ['config', 'default', 'disabled', 'redirect', 'tls', 'multi'],
          () => httpEffects(request),
        );
      } catch {
        report.failures.push('HTTP oracle effect assertion failed');
      }
      checkpoint('http-complete');
    }
    try {
      checkpoint('dns');
      report.requests.dns = await attempt(
        'dns',
        'dig,nslookup',
        ['search', 'domain', 'srchlist', 'tsig'],
        dnsEffects,
      );
      checkpoint('dns-complete');
    } catch (error) {
      report.failures.push('DNS oracle effect assertion failed');
    }
    for (const [name, run] of [
      ['wildcard', wildcardDnsEffects],
      [
        'historical',
        () =>
          historicalEffects({
            shells: shells.filter((shell) =>
              ['bash', 'zsh'].includes(shellKind(shell)),
            ),
            executables,
          }),
      ],
      ['programs', runProgramEffects],
    ]) {
      checkpoint(name);
      if (name === 'programs' && process.platform !== 'linux') {
        report.requests[name] = { status: 'not-applicable' };
        continue;
      }
      try {
        const result = await attempt(
          name,
          name === 'historical' ? shells.join(',') : 'native-programs',
          [],
          run,
        );
        report.requests[name] = result;
        report.failures.push(...(result.failures ?? []));
        report.pending.push(
          ...(result.pending ?? []).map((reason) => `${name}: ${reason}`),
        );
      } catch {
        report.failures.push(`${name}: independent effect fixture failed`);
      }
    }
    for (const [name, run] of [
      ['resolved', runResolvedSearchFixture],
      ['sshAuthenticated', runSshAuthenticatedFixture],
    ]) {
      checkpoint(name);
      if (process.platform !== 'linux') {
        report.requests[name] = { status: 'not-applicable' };
        continue;
      }
      try {
        const result = await attempt(
          name,
          name === 'historical' ? shells.join(',') : 'native-programs',
          [],
          run,
        );
        report.requests[name] = result;
        if (name === 'sshAuthenticated' && result.status === 'passed') {
          report.pending = report.pending.filter(
            (reason) =>
              !/^programs: (?:ssh|scp)\/authenticated-delivery:/u.test(reason),
          );
        }
        if (
          result.status !== 'passed' &&
          !(
            name === 'sshAuthenticated' &&
            report.pending.some((reason) =>
              /^programs: (?:ssh|scp)\/authenticated-delivery:/u.test(reason),
            )
          )
        )
          report.pending.push(`${name}: ${result.reason}`);
      } catch {
        report.failures.push(`${name}: CI effect fixture failed`);
      }
    }
    for (const shell of shells) {
      const entry = {
        shell,
        available: false,
        argvCases: 0,
        restoration: null,
        wrongExpectationDetected: false,
        failures: [],
        differences: [],
      };
      report.shells.push(entry);
      const probeFixture = freshEnvironment('shell-probe');
      const probe = await attempt('shell-probe', shell, ['availability'], () =>
        invoke(
          shellExecutable(shell, executables),
          shellArguments(
            shell,
            shellKind(shell) === 'cmd' ? 'exit /b 0' : 'exit 0',
          ),
          probeFixture,
        ),
      );
      probeFixture.cleanup();
      if (probe.status !== 0) {
        entry.failures.push('required shell missing');
        continue;
      }
      entry.available = true;
      checkpoint(shell + '-corpus');
      entry.corpus = await attempt('corpus-argv', shell, [], () =>
        runCorpusArgvOracle(shell, executables),
      );
      if (!entry.corpus.complete || entry.corpus.status !== 0)
        entry.failures.push('generated corpus execution incomplete');
      entry.failures.push(
        ...entry.corpus.failures.map((id) => `${id}: authored argv mismatch`),
      );
      checkpoint(shell + '-direct');
      const directRows = argvRows(shell);
      const batched =
        shellKind(shell) === 'powershell'
          ? await attempt(
              'direct-argv',
              shell,
              directRows.map((row) => row.id),
              () =>
                executePowerShellArgvCases(directRows, { shell, executables }),
            )
          : null;
      for (const [index, row] of directRows.entries()) {
        try {
          const observed = await attempt(
            'direct-argv',
            shell,
            [row.id],
            async () => {
              const observed =
                batched?.observations[index] ??
                (await executeArgvCase(
                  { ...row, shell },
                  { shell, executables },
                ));
              assert.equal(
                observed.status,
                0,
                `${shell}/${row.id}: shell failed`,
              );
              assert.equal(
                observed.calls.length,
                1,
                `${shell}/${row.id}: invocation count`,
              );
              assert.deepEqual(
                observed.calls[0].argv,
                row.expected,
                `${shell}/${row.id}: argv mismatch`,
              );
              if (row.stdin)
                assert.equal(
                  observed.calls[0].stdin,
                  row.stdin,
                  `${shell}/${row.id}: stdin mismatch`,
                );
              return observed;
            },
          );
          if (!entry.wrongExpectationDetected) {
            assert.throws(
              () =>
                assert.deepEqual(observed.calls[0].argv, [
                  'deliberately-wrong',
                ]),
              assert.AssertionError,
            );
            entry.wrongExpectationDetected = true;
          }
          if (row.id === 'array-origin')
            entry.differences.push({
              id: 'bash-zsh-array-origin',
              category: 'array-origin',
              expectedIndexBase: shellKind(shell) === 'zsh' ? 1 : 0,
            });
          entry.argvCases++;
        } catch (error) {
          if (
            !report.diagnostics.some(
              (entry) =>
                entry.oracle === 'direct-argv' &&
                entry.shell === shell &&
                entry.caseIds.includes(row.id),
            )
          )
            report.diagnostics.push({
              oracle: 'direct-argv',
              shell,
              caseIds: [row.id],
              message: safeDiagnosticText(error.message),
              commands: [],
            });
          entry.failures.push(`${row.id}: shell argv oracle failed`);
        }
      }
      try {
        if (!request)
          throw new Error('restoration loopback fixture unavailable');
        checkpoint(shell + '-restoration');
        entry.restoration = await attempt(
          'restoration',
          shell,
          ['delivery', 'exit-status', 'hook-restoration'],
          () => restoration(shell, executables, request),
        );
      } catch (error) {
        entry.failures.push('restoration effect assertion failed');
      }
      try {
        checkpoint(shell + '-parser');
        entry.parser = await attempt('parser', shell, [], () =>
          runParserOracles({ shell, executables }),
        );
        entry.failures.push(...entry.parser.failures);
        entry.failures.push(
          ...entry.parser.disagreements.map(
            (row) => `${row.id}: parser disagrees with real shell`,
          ),
        );
        entry.differences.push(...entry.parser.disagreements);
      } catch {
        entry.failures.push('real parser oracle failed');
      }
    }
  } catch (error) {
    report.failures.push(
      `uncaught oracle failure: ${safeDiagnosticText(error.message)}`,
    );
  } finally {
    checkpoint('cleanup');
    await request?.cleanup();
    finalizeFixtureCleanup(report);
    checkpoint('finished');
  }
  for (const entry of report.shells)
    report.failures.push(
      ...entry.failures.map((reason) => `${entry.shell}: ${reason}`),
    );
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const flag = process.argv.indexOf('--shells');
  const shells =
    flag >= 0 ? process.argv[flag + 1].split(',') : ['bash', 'zsh'];
  const report = await runDestinationOracles({ shells });
  const summary = {
    ...report,
    shells: report.shells.map((entry) => ({
      ...entry,
      corpus: entry.corpus && { ...entry.corpus, observations: undefined },
    })),
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  process.exitCode = report.failures.length ? 1 : 0;
}
