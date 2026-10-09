#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Diagnostic only. No product switches, inherited credentials, daemon, or shell
// execution: every event and every file belongs to this disposable fixture.
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeProbeFixture } from './windows-crash-cleanup.mjs';
import { NORMAL_CODE } from '../fixtures/normal-code.mjs';
import { encodeProjectPath } from '../../packages/zeroh-disclosure-core/session.js';

const variants = {
  baseline: {},
  'warm-home': {},
  'spawn-while-worker': {},
  'loader-control': {},
  'no-bookkeeping': {},
  'no-main-worker': {},
  'no-acl': {},
  'no-fatal-report': { report: false },
  'no-async-context-frame': { option: '--no-async-context-frame' },
  jitless: { option: '--jitless' },
};
const root = path.resolve(process.env.ZEROH_CRASH_PROBE_ROOT || '');
const parent = process.env.RUNNER_TEMP || process.env.TMPDIR;
const relative = parent && path.relative(path.resolve(parent), root);
if (
  !process.env.ZEROH_CRASH_PROBE_ROOT ||
  !relative ||
  relative.startsWith('..') ||
  path.isAbsolute(relative)
)
  throw new Error(
    'ZEROH_CRASH_PROBE_ROOT must be strictly inside RUNNER_TEMP or TMPDIR',
  );
const iterations = Number(process.env.ZEROH_CRASH_PROBE_ITERATIONS || 300);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 300)
  throw new Error('Probe iterations must be between 1 and 300');
const selected =
  process.env.ZEROH_CRASH_PROBE_VARIANTS?.split(',') || Object.keys(variants);
if (selected.some((name) => !Object.hasOwn(variants, name)))
  throw new Error('Unknown probe variant');
const evidence = path.join(root, 'evidence');
const homes = path.join(root, 'homes');
mkdirSync(evidence, { recursive: true });
mkdirSync(homes, { recursive: true });
const run = fileURLToPath(new URL('../../hooks/run.js', import.meta.url));
const preload = new URL('./windows-crash-preload.mjs', import.meta.url).href;
const summary = {
  node: process.version,
  platform: process.platform,
  iterations,
  variants: [],
  cleanupFailures: [],
};
// A fixture that cannot be removed is evidence (for example a detached child
// still holding it), not a reason to lose the remaining variants.
const removeFixture = (directory) =>
  removeProbeFixture(directory, summary.cleanupFailures);
const writeSummary = () => {
  writeFileSync(
    path.join(evidence, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  const lines = [
    `Cleanup result: ${summary.cleanupFailures.length ? 'RED' : 'green'} — ${summary.cleanupFailures.length} fixture cleanup failures.`,
    'Primary success: baseline and warm-home must each have zero native crashes on Node 26.1.0 (300 pre + 300 post). Check behaviour mismatches separately.',
    'warm-home reuses one home across both hooks and all attempts; it includes the initial cold protection. baseline remains fresh-home per attempt.',
    'spawn-while-worker runs 600 standalone controls (the hook columns are batching labels), without Disclosure or instrumentation. Nonzero native crashes support the spawn/worker trigger; zero does not refute a rare race. Compare Node 22 and Node 26; preserve dumps and exit codes.',
    '',
    '| Variant | Hook | Attempts | Native crashes | Crash rate | Exit codes | Behaviour mismatches |',
    '| --- | --- | ---: | ---: | ---: | --- | ---: |',
  ];
  for (const variant of summary.variants) {
    if (variant.skipped) {
      lines.push(`| ${variant.name} | skipped: ${variant.skipped} | | | | | |`);
      continue;
    }
    for (const [hook, counts] of Object.entries(variant.hooks))
      lines.push(
        `| ${variant.name} | ${hook} | ${counts.attempts} | ${counts.nativeCrashes} | ${((100 * counts.nativeCrashes) / (counts.attempts || 1)).toFixed(2)}% | ${JSON.stringify(counts.exitCodes)} | ${counts.mismatches} |`,
      );
  }
  if (summary.cleanupFailures.length)
    lines.push(
      '',
      `Fixture cleanup failures: ${summary.cleanupFailures.length} (${[...new Set(summary.cleanupFailures.map((row) => row.code))].join(', ')})`,
    );
  writeFileSync(path.join(evidence, 'summary.md'), lines.join('\n') + '\n');
};

function fixture() {
  const base = mkdtempSync(path.join(homes, 'fake-'));
  const directories = {
    HOME: 'home',
    USERPROFILE: 'home',
    TMPDIR: '',
    TMP: '',
    TEMP: '',
    ZEROH_HOME: 'zeroh',
    ZEROH_CREDENTIAL_HOME: 'credentials',
    CLAUDE_CONFIG_DIR: 'claude',
    XDG_CONFIG_HOME: 'config',
    XDG_STATE_HOME: 'state',
    APPDATA: 'appdata',
    LOCALAPPDATA: 'localappdata',
    ZEROH_SERVICE_MANAGER_DIR: 'service-manager',
  };
  // Deliberate allowlist: NODE_OPTIONS, provider keys and the runner's token
  // never enter a hook child (including its native dump or Node report).
  const env = {};
  for (const key of [
    'PATH',
    'SystemRoot',
    'SYSTEMROOT',
    'windir',
    'WINDIR',
    'ComSpec',
    'COMSPEC',
    'PATHEXT',
  ])
    if (process.env[key]) env[key] = process.env[key];
  for (const [key, directory] of Object.entries(directories)) {
    env[key] = path.join(base, directory);
    mkdirSync(env[key], { recursive: true });
  }
  const project = path.join(base, 'project');
  mkdirSync(path.join(project, '.claude'), { recursive: true });
  const settings = path.join(project, '.claude', 'settings.json');
  writeFileSync(settings, '{}\n');
  env.ZEROH_CLAUDE_SETTINGS = path.join(env.CLAUDE_CONFIG_DIR, 'settings.json');
  writeFileSync(env.ZEROH_CLAUDE_SETTINGS, '{}\n');
  Object.assign(env, {
    CLAUDE_PROJECT_DIR: project,
    ZEROH_UNCERTAIN: 'block',
    ZEROH_PROXY: 'off',
    ZEROH_PHONE_REGION: 'none',
  });
  const session = path.join(
    env.ZEROH_HOME,
    'projects',
    encodeProjectPath(project),
    'sessions',
    'ZEROHFAKE-probe',
  );
  mkdirSync(session, { recursive: true });
  writeFileSync(
    path.join(session, 'state.json'),
    JSON.stringify({ turnCount: 1 }),
  );
  writeFileSync(
    path.join(session, 'turn-1.json'),
    JSON.stringify({
      format_disclosure: { withheld: {}, passed_unmasked: {} },
    }),
  );
  for (const name of ['review/permissions.ini', 'src/credentials.d.ts']) {
    const file = path.join(project, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, NORMAL_CODE[name]);
  }
  return { base, project, settings, env };
}

function event(fixture, hook, index) {
  const common = {
    cwd: fixture.project,
    session_id: 'ZEROHFAKE-probe',
    tool_use_id: 'ZEROHFAKE-tool',
  };
  if (hook === 'pre-tool-use')
    return {
      shape: index % 2 ? 'monitor-settings' : 'perl-settings',
      input: {
        ...common,
        hook_event_name: 'PreToolUse',
        tool_name: index % 2 ? 'Monitor' : 'Bash',
        tool_input: {
          command:
            index % 2
              ? 'echo ZEROH_PROXY=off >> .zeroh.env; tail -f app.log'
              : `perl -0e 'open(F, ">", "${fixture.settings.replaceAll('\\', '/')}"); print F "{}";'`,
        },
      },
    };
  const name = index % 2 ? 'src/credentials.d.ts' : 'review/permissions.ini';
  return {
    shape: index % 2 ? 'tail-normal-code' : 'show-normal-code',
    input: {
      ...common,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: {
        command:
          index % 2
            ? `tail "${path.join(fixture.project, name).replaceAll('\\', '/')}"`
            : `git show HEAD:${name}`,
      },
      tool_response: { stdout: NORMAL_CODE[name], stderr: '' },
    },
  };
}

for (const name of selected) {
  const variant = variants[name];
  const row = { name, hooks: {}, trace: {} };
  summary.variants.push(row);
  if (
    variant.option &&
    !process.allowedNodeEnvironmentFlags.has(variant.option)
  ) {
    row.skipped = `${variant.option} unsupported on ${process.version}`;
    writeSummary();
    continue;
  }
  const warm = name === 'warm-home' ? fixture() : null;
  for (const hook of ['pre-tool-use', 'post-tool-use']) {
    const counts = {
      attempts: 0,
      nativeCrashes: 0,
      mismatches: 0,
      exitCodes: {},
      shapes: {},
    };
    row.hooks[hook] = counts;
    for (let index = 0; index < iterations; index += 1) {
      const current = warm || fixture();
      try {
        const sample = event(current, hook, index);
        const stem = `${name}-${hook}-${index}`;
        const traceFile = path.join(evidence, `${stem}.trace.jsonl`);
        const reportDir = path.join(evidence, 'reports', stem);
        mkdirSync(reportDir, { recursive: true });
        const report =
          variant.report !== false
            ? `--report-on-fatalerror --report-directory="${reportDir.replaceAll('\\', '/')}"`
            : '';
        // Baseline executes the production loader without any preload,
        // builtin patch, custom module loader, or fatal-report instrumentation.
        const control = name === 'spawn-while-worker';
        const production =
          name === 'baseline' || name === 'warm-home' || control;
        const env = {
          ...current.env,
          ...(production
            ? {}
            : {
                NODE_OPTIONS: [report, variant.option]
                  .filter(Boolean)
                  .join(' '),
                ZEROH_CRASH_PROBE_VARIANT: name,
                ZEROH_CRASH_PROBE_TRACE: traceFile,
              }),
        };
        const result = spawnSync(
          process.execPath,
          control
            ? [
                fileURLToPath(
                  new URL('./windows-spawn-while-worker.mjs', import.meta.url),
                ),
              ]
            : production
              ? [run, hook]
              : ['--import', preload, run, hook],
          {
            cwd: current.project,
            env,
            input: JSON.stringify(sample.input),
            encoding: 'utf8',
            windowsHide: true,
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
          },
        );
        const exit =
          result.status === null
            ? result.error?.code || result.signal || 'unknown'
            : String(result.status >>> 0);
        const nativeCrash =
          result.status !== null && result.status >>> 0 >= 0x80000000;
        let answer = null;
        try {
          answer = JSON.parse(result.stdout);
        } catch {
          /* A clean post hook can emit nothing. */
        }
        const correct =
          result.status === 0 &&
          (control
            ? result.stdout.trim() === 'ZEROHFAKE-control-ok'
            : hook === 'pre-tool-use'
              ? answer?.hookSpecificOutput?.permissionDecision === 'deny'
              : !answer?.hookSpecificOutput?.updatedToolOutput &&
                !answer?.systemMessage);
        counts.attempts += 1;
        counts.nativeCrashes += Number(nativeCrash);
        counts.mismatches += Number(!correct);
        counts.exitCodes[exit] = (counts.exitCodes[exit] || 0) + 1;
        const shapeName = control ? 'idle-worker-trivial-child' : sample.shape;
        const shape = (counts.shapes[shapeName] ||= {
          attempts: 0,
          nativeCrashes: 0,
        });
        shape.attempts += 1;
        shape.nativeCrashes += Number(nativeCrash);
        let traces = [];
        try {
          traces = readFileSync(traceFile, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        } catch {
          /* Crash before preload is evidence too. */
        }
        for (const trace of traces)
          row.trace[trace.action] = (row.trace[trace.action] || 0) + 1;
        const record = {
          variant: name,
          hook,
          index,
          shape: shapeName,
          home: current.env.ZEROH_HOME,
          pid: result.pid,
          exit,
          nativeCrash,
          correct,
          error: result.error?.code,
          signal: result.signal,
          traces,
        };
        appendFileSync(
          path.join(evidence, 'invocations.jsonl'),
          JSON.stringify(record) + '\n',
        );
        if (!correct || result.stderr)
          writeFileSync(
            path.join(evidence, `${stem}.output.json`),
            JSON.stringify(
              { ...record, stdout: result.stdout, stderr: result.stderr },
              null,
              2,
            ),
          );
        if ((index + 1) % 25 === 0 || index + 1 === iterations) {
          writeSummary();
          console.log(
            `${name} ${hook}: ${counts.attempts}/${iterations}, native crashes=${counts.nativeCrashes}, mismatches=${counts.mismatches}`,
          );
        }
      } finally {
        if (!warm) await removeFixture(current.base);
      }
    }
  }
  if (warm) await removeFixture(warm.base);
}
writeSummary();
await removeFixture(homes);
writeSummary();
// A diagnostic succeeds when evidence is collected. Behaviour failures and
// native crashes remain explicit counts, rather than aborting the next variant.

process.exitCode = summary.cleanupFailures.length ? 1 : 0;
