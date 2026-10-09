// SPDX-License-Identifier: AGPL-3.0-only

// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadavg } from 'node:os';
import { hookDeadlineMs } from '../../../hooks/fail-closed.js';
import { safeDiagnosticText, spawnFileSync } from './process-files.mjs';

export const COLD_SAMPLE_COUNT = 20;
export const PARSER_LIMITS = { bash: 300, powershell: 2500 };
export const HOOK_LIMITS = { bash: 1000, powershell: 3000 };

export function validateColdProcess(
  result,
  elapsedMs,
  deadlineMs = hookDeadlineMs('pre-tool-use', {}),
) {
  if (
    result.error ||
    result.status !== 0 ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    elapsedMs >= deadlineMs
  )
    throw new Error('Cold process failed or exceeded the hook deadline');
}

export function validateHookSample(result, marker, elapsedMs, deadlineMs) {
  validateColdProcess(result, elapsedMs, deadlineMs);
  if (marker?.parsed !== true)
    throw new Error('Parser adapter marker is missing');
  const failed =
    /timed out|check failed|parser[- ](?:failure|unavailable|timeout)|checking it took too long|could not check|couldn't check/iu;
  if (failed.test(`${result.stdout ?? ''}\n${result.stderr ?? ''}`))
    throw new Error(
      'Actual PreToolUse hook reported watchdog or parser failure',
    );
  for (const line of (result.stdout ?? '').trim().split('\n').filter(Boolean)) {
    JSON.parse(line);
  }
}

export function percentiles(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  if (
    sorted.length !== COLD_SAMPLE_COUNT ||
    sorted.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error('Twenty finite cold samples are required');
  return {
    count: sorted.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

export function gateVerdict(
  parser,
  hook,
  family,
  fallbackEvidence = null,
  baseline = null,
) {
  const parserPassed =
    (family === 'bash' ? parser.p50Ms : parser.p95Ms) < PARSER_LIMITS[family];
  const wholeHookPassed =
    hook.p95Ms < HOOK_LIMITS[family] &&
    (family !== 'bash' ||
      (Number.isFinite(baseline?.p95Ms) && hook.p95Ms <= baseline.p95Ms + 150));
  const adapterPassed = parserPassed && wholeHookPassed;
  const fallbackPassed =
    !adapterPassed &&
    fallbackEvidence?.correctnessPassed === true &&
    fallbackEvidence?.noticePassed === true;
  return {
    parserPassed,
    wholeHookPassed,
    adapterPassed,
    fallbackPassed,
    releasePassed: adapterPassed || fallbackPassed,
    decision: adapterPassed
      ? 'adapter-eligible'
      : fallbackPassed
        ? 'verified-1.0-fallback'
        : 'blocked-unverified-1.0-fallback',
  };
}

export function interleaveHookSamples(runSample) {
  const hookSamples = [];
  const baselineSamples = [];
  for (let sample = 0; sample < COLD_SAMPLE_COUNT; sample++) {
    for (const withAdapter of [false, true]) {
      const elapsedMs = runSample(withAdapter, sample);
      (withAdapter ? hookSamples : baselineSamples).push(elapsedMs);
    }
  }
  return { hookSamples, baselineSamples };
}

function isolatedSample() {
  if (
    !process.env.TMPDIR ||
    !process.env.HOME ||
    !process.env.ZEROH_HOME ||
    !process.env.CLAUDE_CONFIG_DIR
  )
    throw new Error(
      'Run benchmark through the isolated destination CI/test environment',
    );
  const root = mkdtempSync(path.join(process.env.TMPDIR, 'zeroh-parser-cold-'));
  const env = {};
  for (const name of ['PATH', 'SystemRoot', 'ComSpec', 'WINDIR'])
    if (process.env[name]) env[name] = process.env[name];
  for (const [name, folder] of Object.entries({
    HOME: 'home',
    USERPROFILE: 'home',
    ZEROH_HOME: 'zeroh',
    ZEROH_CREDENTIAL_HOME: 'credentials',
    CLAUDE_CONFIG_DIR: 'claude',
    ZEROH_SERVICE_MANAGER_DIR: 'services',
    TMPDIR: 'tmp',
    TMP: 'tmp',
    TEMP: 'tmp',
    CLAUDE_PROJECT_DIR: 'project',
  })) {
    env[name] = path.join(root, folder);
    mkdirSync(env[name], { recursive: true });
  }
  env.ZEROH_CLAUDE_SETTINGS = path.join(env.CLAUDE_CONFIG_DIR, 'settings.json');
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const claude = path.join(
    bin,
    process.platform === 'win32' ? 'claude.cmd' : 'claude',
  );
  writeFileSync(
    claude,
    process.platform === 'win32'
      ? '@echo off\r\necho 2.1.288 (Claude Code)\r\n'
      : '#!/bin/sh\nprintf "%s\\n" "2.1.288 (Claude Code)"\n',
  );
  chmodSync(claude, 0o755);
  env.PATH = `${bin}${path.delimiter}${env.PATH || ''}`;
  env.ZEROH_CLAUDE_BIN = claude;
  env.ZEROH_PROXY = 'off';
  env.POWERSHELL_TELEMETRY_OPTOUT = '1';
  env.POWERSHELL_UPDATECHECK = 'Off';
  env.DOTNET_CLI_TELEMETRY_OPTOUT = '1';
  env.ZEROH_PUBLISHED_VERSION_CHECK = 'off';
  return { root, env };
}

export function checkCstIdentity() {
  const isolated = isolatedSample();
  try {
    const script = fileURLToPath(new URL('./cst-worker.mjs', import.meta.url));
    const results = ['default', 'liftoff'].map((tier) => {
      const result = spawnFileSync(process.execPath, [script, tier], {
        env: isolated.env,
        encoding: 'utf8',
        timeout: 10000,
      });
      validateColdProcess(result, 0);
      return JSON.parse(result.stdout);
    });
    if (
      results.some((row) => row.count !== 60) ||
      results[0].sha256 !== results[1].sha256
    )
      throw new Error('Liftoff and default CST snapshots differ');
    return {
      count: 60,
      defaultSha256: results[0].sha256,
      liftoffSha256: results[1].sha256,
      identical: true,
    };
  } finally {
    rmSync(isolated.root, { recursive: true, force: true });
  }
}

export function runBenchmark({ shell = 'bash', executable, output } = {}) {
  if (shell === 'cmd') {
    const result = {
      schemaVersion: 1,
      platform: process.platform,
      shell,
      passed: true,
      fallbackPassed: false,
      status: 'not-applicable',
      reason:
        'Phase 42 retains the cmd parser; no new parser adapter is selected.',
    };
    if (output) writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (
    !['bash', 'bash-3.2', 'zsh', 'git-bash', 'pwsh', 'powershell-5.1'].includes(
      shell,
    )
  )
    throw new Error('Unknown benchmark shell');
  const family = ['pwsh', 'powershell-5.1'].includes(shell)
    ? 'powershell'
    : 'bash';
  executable ||=
    shell === 'powershell-5.1'
      ? 'powershell.exe'
      : family === 'powershell'
        ? 'pwsh'
        : shell === 'bash-3.2'
          ? '/bin/bash'
          : shell === 'zsh'
            ? 'zsh'
            : 'bash';
  const probe = spawnSync(
    executable,
    family === 'powershell'
      ? [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$PSVersionTable.PSVersion.Major',
        ]
      : ['--version'],
    { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (probe.error || probe.status !== 0)
    throw new Error('Required shell is missing');
  const corpusPath = new URL(
    '../destinations/seeds/spike-42.txt',
    import.meta.url,
  );
  const corpus = readFileSync(corpusPath, 'utf8');
  const corpusSha256 = createHash('sha256').update(corpus).digest('hex');
  if (
    corpusSha256 !==
    'ad0f8ceaa5d31a86e093308bd5256a6d44a746309c4483fc58468c4fcaa2bb28'
  )
    throw new Error('Phase 42 spike corpus hash mismatch');
  const commands = corpus
    .trimEnd()
    .split('\n')
    .map((line) => line.replaceAll('\\n', '\n'));
  if (commands.length !== 60)
    throw new Error('Pinned spike corpus must contain sixty commands');
  const representativeIndex = commands.findIndex(
    (command) =>
      /curl\b/u.test(command) &&
      /Authorization:/iu.test(command) &&
      /https?:\/\//u.test(command),
  );
  if (representativeIndex < 0)
    throw new Error('Spike corpus lacks representative authorization curl');
  const representativeCommand = commands[representativeIndex].replace(
    /\bT\b/gu,
    'ZEROHFAKE',
  );
  const parserSamples = [];
  const loadSamples = [];
  const commandSamples = [];
  const passSamples = [];
  const loadAverage = { start: loadavg() };
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const hook = fileURLToPath(new URL('../../../hooks/run.js', import.meta.url));
  for (let sample = 0; sample < COLD_SAMPLE_COUNT; sample++) {
    const isolated = isolatedSample();
    try {
      const inputPath = path.join(isolated.root, 'commands.json');
      writeFileSync(inputPath, JSON.stringify(commands));
      const start = performance.now();
      const parsed = spawnFileSync(
        process.execPath,
        [path.join(dir, 'cold-worker.mjs'), shell, inputPath, executable],
        {
          env: isolated.env,
          cwd: isolated.env.CLAUDE_PROJECT_DIR,
          encoding: 'utf8',
          timeout: 10000,
        },
      );
      const elapsedMs = performance.now() - start;
      validateColdProcess(parsed, elapsedMs);
      parserSamples.push(elapsedMs);
      const measures = JSON.parse(parsed.stdout);
      loadSamples.push(measures.loadMs);
      commandSamples.push(measures.perCommandMs);
      passSamples.push(measures.passMs);
    } finally {
      rmSync(isolated.root, { recursive: true, force: true });
    }
  }
  const cstIdentity = family === 'bash' ? checkCstIdentity() : null;
  loadAverage.afterParser = loadavg();
  // ABAB pairs use the same command, runner and executable Node; no concurrent work.
  const { hookSamples, baselineSamples } = interleaveHookSamples(
    (withAdapter) => {
      const isolated = isolatedSample();
      try {
        const marker = path.join(isolated.root, 'adapter-ran.json');
        if (family === 'bash') isolated.env.CLAUDE_CODE_SHELL = executable;
        isolated.env.ZEROH_TEST_PARSER_SHELL = shell;
        isolated.env.ZEROH_TEST_PARSER_EXECUTABLE = executable;
        isolated.env.ZEROH_TEST_PARSER_MARKER = marker;
        const event = {
          session_id: 'cold-parser-gate',
          cwd: isolated.env.CLAUDE_PROJECT_DIR,
          tool_name: family === 'powershell' ? 'PowerShell' : 'Bash',
          tool_input: {
            command: representativeCommand,
          },
        };
        const start = performance.now();
        const result = spawnFileSync(
          process.execPath,
          [
            ...(withAdapter
              ? // A bare D:\ path is read as a URL scheme by --import on Windows.
                [
                  '--import',
                  pathToFileURL(path.join(dir, 'hook-preload.mjs')).href,
                ]
              : []),
            hook,
            'pre-tool-use',
          ],
          {
            input: JSON.stringify(event),
            env: isolated.env,
            cwd: isolated.env.CLAUDE_PROJECT_DIR,
            encoding: 'utf8',
            timeout: 10000,
          },
        );
        const elapsedMs = performance.now() - start;
        validateHookSample(
          result,
          withAdapter ? adapterMarker(marker, result) : { parsed: true },
          elapsedMs,
        );
        return elapsedMs;
      } finally {
        rmSync(isolated.root, { recursive: true, force: true });
      }
    },
  );
  loadAverage.end = loadavg();
  const parser = percentiles(parserSamples);
  const wholeHook = percentiles(hookSamples);
  const noAdapterHook = percentiles(baselineSamples);
  const result = {
    schemaVersion: 1,
    platform: process.platform,
    shell,
    executable,
    node: process.versions.node,
    loadAverage,
    hookOrder: 'ABAB: no-adapter, adapter, repeated twenty times',
    corpusSha256,
    corpusCount: commands.length,
    representativeCorpusIndex: representativeIndex,
    sampleCount: COLD_SAMPLE_COUNT,
    cstIdentity,
    statisticPendingOwnerConfirmation:
      'Ruling text: parser p50; memo: parser p95. Whole hook uses memo p95 pending confirmation.',
    adapterDeltaMs: {
      p50: wholeHook.p50Ms - noAdapterHook.p50Ms,
      p95: wholeHook.p95Ms - noAdapterHook.p95Ms,
    },
    measurementMethods: {
      noAdapterHook:
        'Same runner, Node, shell tool and representative curl command as wholeHook, with no parser preload.',
      parser:
        'Fresh Node process wall time, including runtime initialization, sixty ParseInput/CST parses, and transport/serialization; no destination policy.',
      runtimeLoad:
        family === 'powershell'
          ? 'PowerShell process wall time minus reported parse/token pass time; includes startup, transport, and JSON serialization.'
          : 'Dynamic runtime import plus Parser.init and Language.load inside each fresh process.',
      perCommand:
        'Sixty-command pass divided by sixty; warm commands inside each cold process.',
      sixtyCommandPass:
        'Sixty parse/token calls inside each fresh process; no command executes.',
      wholeHook:
        'Fresh Node process running hooks/run.js pre-tool-use; --import loads the adapter in the actual hook worker before PreToolUse.',
    },
    measures: {
      runtimeLoad: percentiles(loadSamples),
      perCommand: percentiles(commandSamples),
      sixtyCommandPass: percentiles(passSamples),
      parser,
      wholeHook,
      noAdapterHook,
    },
    gatesMs: {
      parser: PARSER_LIMITS[family],
      parserStatistic: family === 'bash' ? 'p50' : 'p95',
      wholeHookStatistic: 'p95',
      wholeHookDelta: family === 'bash' ? 150 : null,
      wholeHook: HOOK_LIMITS[family],
      hookDeadline: hookDeadlineMs('pre-tool-use', {}),
    },
    verdict: gateVerdict(parser, wholeHook, family, null, noAdapterHook),
    rawSamples: {
      parser: parserSamples,
      runtimeLoad: loadSamples,
      perCommand: commandSamples,
      sixtyCommandPass: passSamples,
      wholeHook: hookSamples,
      noAdapterHook: baselineSamples,
    },
  };
  result.passed = result.verdict.releasePassed;
  result.fallbackPassed = result.verdict.fallbackPassed;
  if (output) writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const option = (name) => args[args.indexOf(name) + 1];
  const result = runBenchmark({
    shell: args.includes('--shell') ? option('--shell') : 'bash',
    executable: args.includes('--executable')
      ? option('--executable')
      : undefined,
    output: args.includes('--output') ? option('--output') : undefined,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

// A missing marker means the preload never parsed inside the hook worker; show
// the hook's own answer instead of a bare ENOENT.
export function adapterMarker(marker, result) {
  if (existsSync(marker)) return JSON.parse(readFileSync(marker, 'utf8'));
  throw new Error(
    'benchmark parser preload did not run in the hook worker: ' +
      safeDiagnosticText(
        `stderr=${result.stderr ?? ''}\nexit=${result.status} signal=${result.signal} error=${result.error?.code ?? ''} stdout=${result.stdout ?? ''}`,
      ),
  );
}
