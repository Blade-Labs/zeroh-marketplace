#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, '..');
const runtime = join(pluginRoot, 'bin', 'zeroh-sdd.mjs');
const root = mkdtempSync(join(tmpdir(), 'zeroh-sdd-codex-hook-discovery-'));
const userHooksPath = join(homedir(), '.codex', 'hooks.json');
const backupPath = join(homedir(), '.codex', `hooks.backup-${Date.now()}.json`);

const scenarios = [];

main();

function main() {
  mkdirSync(join(root, '.codex'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'allowed.ts'), 'export const allowed = true;\n', 'utf8');
  spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });

  const codexVersion = run('codex', ['--version']).stdout.trim();
  const featureOutput = run('codex', ['features', 'list']).stdout;
  const hooksLine = featureOutput.split(/\r?\n/).filter((line) => /^(hooks|plugin_hooks)\s/.test(line)).join('\n');

  scenarios.push(testProjectHooks());
  scenarios.push(testUserHooks());
  scenarios.push(testInlineHooks());
  scenarios.push(testLiveWrongFileGuard());
  scenarios.push(testDirectRuntimeAdapter());

  const report = renderReport({ codexVersion, hooksLine });
  const reportPath = join(root, 'codex-hook-discovery-report.md');
  writeFileSync(reportPath, report, 'utf8');
  console.log(reportPath);
  console.log(report);
  process.exitCode = scenarios.some((scenario) => scenario.result === 'FAIL') ? 1 : 0;
}

function testProjectHooks() {
  const marker = join(root, 'project-hook-marker.txt');
  writeFileSync(join(root, '.codex', 'hooks.json'), JSON.stringify({
    hooks: {
      SessionStart: [{
        matcher: 'startup|resume|clear',
        hooks: [{ type: 'command', command: markerCommand(marker), statusMessage: 'zeroh-sdd project marker' }],
      }],
    },
  }, null, 2), 'utf8');
  const log = join(root, 'project-hooks.jsonl');
  const result = codexExec(['--cd', root, '--sandbox', 'danger-full-access', '--json', 'Reply exactly: project-hooks-ok'], log);
  return scenario('project-local hooks', 'SessionStart writes project hook marker', existsSync(marker), result, log, marker);
}

function testUserHooks() {
  const marker = join(root, 'user-hook-marker.txt');
  const hadUserHooks = existsSync(userHooksPath);
  if (hadUserHooks) renameSync(userHooksPath, backupPath);
  try {
    mkdirSync(dirname(userHooksPath), { recursive: true });
    writeFileSync(userHooksPath, JSON.stringify({
      hooks: {
        SessionStart: [{
          matcher: 'startup|resume|clear',
          hooks: [{ type: 'command', command: markerCommand(marker), statusMessage: 'zeroh-sdd user marker' }],
        }],
      },
    }, null, 2), 'utf8');
    const log = join(root, 'user-hooks.jsonl');
    const result = codexExec(['--cd', root, '--sandbox', 'danger-full-access', '--json', 'Reply exactly: user-hooks-ok'], log);
    return scenario('user-level hooks', 'SessionStart writes user hook marker', existsSync(marker), result, log, marker);
  } finally {
    rmSync(userHooksPath, { force: true });
    if (hadUserHooks) renameSync(backupPath, userHooksPath);
  }
}

function testInlineHooks() {
  const marker = join(root, 'inline-hook-marker.txt');
  const command = markerScript(marker);
  const configArg = `hooks.SessionStart=[{ matcher = 'startup|resume|clear', hooks = [{ type = 'command', command = '${tomlString(command)}' }] }]`;
  const log = join(root, 'inline-hooks.jsonl');
  const result = codexExec(['--cd', root, '--sandbox', 'danger-full-access', '-c', configArg, '--json', 'Reply exactly: inline-hooks-ok'], log);
  return scenario('inline config hooks', 'SessionStart writes inline hook marker', existsSync(marker), result, log, marker);
}

function testLiveWrongFileGuard() {
  const marker = join(root, 'guard-hook-marker.txt');
  const forbidden = join(root, 'forbidden.txt');
  writeFileSync(join(root, '.codex', 'hooks.json'), JSON.stringify({
    hooks: {
      PreToolUse: [{
        matcher: 'apply_patch|Edit|Write',
        hooks: [{ type: 'command', command: markerCommand(marker), statusMessage: 'zeroh-sdd guard marker' }],
      }],
    },
  }, null, 2), 'utf8');
  rmSync(forbidden, { force: true });
  const log = join(root, 'wrong-file-guard.jsonl');
  const result = codexExec([
    '--cd',
    root,
    '--sandbox',
    'danger-full-access',
    '--json',
    'Use apply_patch to create forbidden.txt containing nope. Then reply exactly: forbidden-attempted',
  ], log);
  return {
    name: 'live wrong-file guard',
    expected: 'PreToolUse fires before apply_patch',
    observed: existsSync(forbidden) ? 'forbidden.txt was created' : 'forbidden.txt absent',
    result: !existsSync(forbidden) && existsSync(marker) ? 'PASS' : 'FAIL',
    exitCode: result.status,
    log,
    marker,
  };
}

function testDirectRuntimeAdapter() {
  const activeStageDir = join(root, '.specify', 'workflows');
  mkdirSync(activeStageDir, { recursive: true });
  writeFileSync(join(activeStageDir, 'active-stage.json'), JSON.stringify({
    version: 1,
    stage: 'Codex direct adapter probe',
    stepId: 'Step 1',
    planPath: 'docs/build-log/probe.md',
    allowedPaths: [{ mode: 'exact', path: 'src/allowed.ts' }],
    proofCommand: 'node --version',
    stopRule: 'Probe only.',
    receiptRequired: true,
    openFindings: [],
  }, null, 2), 'utf8');
  const input = JSON.stringify({
    tool_name: 'apply_patch',
    tool_input: {
      command: '*** Begin Patch\n*** Add File: forbidden-direct.txt\n+nope\n*** End Patch\n',
    },
  });
  const result = spawnSync(process.execPath, [runtime, 'hook', 'pre-tool-write', '--adapter', 'codex'], {
    cwd: root,
    input,
    encoding: 'utf8',
  });
  const passed = result.stdout.includes('"permissionDecision":"deny"');
  return {
    name: 'direct runtime adapter',
    expected: 'zeroh-sdd --adapter codex denies forbidden apply_patch payload',
    observed: passed ? 'permissionDecision deny returned' : trim(result.stdout || result.stderr),
    result: passed ? 'PASS' : 'FAIL',
    exitCode: result.status,
    log: '',
    marker: '',
  };
}

function scenario(name, expected, markerExists, commandResult, log, marker) {
  return {
    name,
    expected,
    observed: markerExists ? 'marker file written' : 'marker file absent',
    result: markerExists ? 'PASS' : 'FAIL',
    exitCode: commandResult.status,
    log,
    marker,
  };
}

function codexExec(args, logPath) {
  const result = run('codex', ['exec', ...args]);
  writeFileSync(logPath, [result.stdout, result.stderr].filter(Boolean).join('\n'), 'utf8');
  return result;
}

function markerCommand(marker) {
  return markerScript(marker);
}

function markerScript(marker) {
  const scriptPath = join(root, `hook-marker-${Math.random().toString(16).slice(2)}.cmd`);
  writeFileSync(scriptPath, `@echo off\r\necho fired>>"${marker}"\r\n`, 'ascii');
  return scriptPath.replace(/\\/g, '/');
}

function tomlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || root,
    input: options.input,
    encoding: 'utf8',
    shell: false,
  });
}

function renderReport({ codexVersion, hooksLine }) {
  const rows = scenarios.map((item) => `| ${item.name} | ${item.expected} | ${item.observed} | ${item.result} |`).join('\n');
  const logs = scenarios
    .filter((item) => item.log)
    .map((item) => `- ${item.name}: ${item.log}`)
    .join('\n');
  return `# Codex Hook Discovery Report

## Environment

- Codex CLI: ${codexVersion}
- Temp root: ${root}
- zeroh-sdd runtime: ${runtime}

\`\`\`text
${hooksLine}
\`\`\`

## Results

| Scenario | Expected | Observed | Result |
| --- | --- | --- | --- |
${rows}

## Interpretation

If the hook marker scenarios fail but the direct runtime adapter passes, the zeroh-sdd Codex adapter is usable but this Codex build is not executing command hooks through the tested sources.

## Evidence

${logs}
`;
}

function trim(value) {
  const text = String(value || '').trim();
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}
