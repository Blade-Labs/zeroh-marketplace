// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { loadavg } from 'node:os';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { PLUGIN, tempProject } from '../helpers.mjs';
import { detectSensitiveData } from '../../packages/zeroh-disclosure-core/detector.js';
import { copyModuleFixture } from '../tools/copy-module-fixture.mjs';
import { sessionStatusPath } from '../../packages/zeroh-disclosure-core/session-status.js';

const fake = 'ZEROH' + 'FAKE9!';
const recoveryOnly = 'fake.js:123:ZEROH' + 'FAKE7!';
const sparse = 'const x = 1;\n'.repeat(29999) + `curl -u "admin:${fake}"\n`;
const dense = `curl -u "admin:${fake}"\n`.repeat(20000);
const cutoffSparse =
  'const x = 1;\n'.repeat(40999) + `curl -u "admin:${fake}"\n`;
const minimal = 'x\n'.repeat(87999) + `curl -u "admin:${fake}"\n`;

function fixtureOutput(project, command, text) {
  writeFileSync(path.join(project.dir, command.at(-1)), text);
  const output = path.join(project.dir, 'fixture-output');
  const fd = openSync(output, 'w');
  try {
    const result = spawnSync(command[0], command.slice(1), {
      cwd: project.dir,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
      stdio: ['ignore', fd, 'inherit'],
      timeout: 20000,
    });
    assert.equal(
      result.error,
      undefined,
      `required search program ${command[0]} failed: ${result.error?.code ?? ''}`,
    );
    assert.equal(
      result.status,
      0,
      `actual search program ${command[0]} failed (exit ${result.status})`,
    );
  } finally {
    closeSync(fd);
  }
  return readFileSync(output, 'utf8');
}

// Files isolate the recovery budget from stdout backpressure. The separate
// piped test below exercises the loader's actual write completion.
function realHook(
  project,
  event,
  {
    piped = false,
    stalled = false,
    delay = '0',
    pluginDir = PLUGIN,
    extraEnv = {},
  } = {},
) {
  const input = path.join(project.dir, 'hook-input');
  const output = path.join(project.dir, 'hook-output');
  writeFileSync(
    input,
    JSON.stringify({
      session_id: 'output-budget',
      cwd: project.dir,
      hook_event_name: 'PostToolUse',
      ...event,
    }),
  );
  const inputFd = openSync(input, 'r');
  const fifo = path.join(project.dir, 'undrained-stdout');
  if (stalled) execFileSync('mkfifo', [fifo], { stdio: 'inherit' });
  // Holding both FIFO ends open never reads a byte, and never sends EPIPE.
  const outputFd = openSync(stalled ? fifo : output, stalled ? 'r+' : 'w');
  const args = [path.join(pluginDir, 'hooks/run.js'), 'post-tool-use'];
  const start = performance.now();
  let result;
  try {
    result = spawnSync(
      piped ? 'bash' : process.execPath,
      piped
        ? [
            '-o',
            'pipefail',
            '-c',
            '"$1" "$2" "$3" | { sleep "$4"; cat; }',
            'fixture',
            process.execPath,
            ...args,
            delay,
          ]
        : args,
      {
        cwd: project.dir,
        env: {
          ...process.env,
          HOME: project.home,
          ZEROH_HOME: project.home,
          ZEROH_CREDENTIAL_HOME: project.home,
          ZEROH_CLAUDE_SETTINGS: project.settings,
          ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
          CLAUDE_CONFIG_DIR: path.join(project.home, 'claude'),
          CLAUDE_PROJECT_DIR: project.dir,
          ZEROH_PROXY: 'off',
          ...extraEnv,
        },
        stdio: [inputFd, outputFd, 'inherit'],
        timeout: stalled ? 6500 : 20000,
      },
    );
  } finally {
    closeSync(inputFd);
    closeSync(outputFd);
  }
  return {
    ...result,
    ms: performance.now() - start,
    stdout: stalled ? '' : readFileSync(output, 'utf8'),
  };
}

function checkMask(
  result,
  t,
  label,
  { saveFailure = false, truncated = false, allowTruncated = false } = {},
) {
  t.diagnostic(
    `${label}: ${result.ms.toFixed(1)} ms; ${Buffer.byteLength(result.stdout)} stdout bytes; load ${loadavg()
      .map((n) => n.toFixed(2))
      .join('/')}`,
  );
  assert.equal(result.status, 0, 'whole hook completed');
  assert.equal(result.error, undefined, 'whole hook did not error');
  if (!allowTruncated)
    assert.ok(
      result.ms < 12500,
      'whole hook stays under 12.5 s with margin before the 13 s watchdog',
    );
  let json;
  assert.doesNotThrow(() => {
    json = JSON.parse(result.stdout);
  }, 'complete JSON answer');
  assert.doesNotMatch(json.systemMessage ?? '', /timed out/u);
  const updated = json.hookSpecificOutput?.updatedToolOutput;
  if (allowTruncated && /not fully checked/u.test(json.systemMessage ?? ''))
    return updated;
  assert.ok(updated, 'protected output has a masking answer');
  assert.ok(!JSON.stringify(updated).includes(fake), 'fake credential masked');
  assert.ok(
    /\[[A-Z_]+-[0-9a-f]{6}\]/u.test(JSON.stringify(updated)),
    'vault mask carried',
  );
  if (saveFailure) assert.match(json.systemMessage, /couldn't save its vault/u);
  else if (truncated) assert.match(json.systemMessage, /not fully checked/u);
  else
    assert.doesNotMatch(
      json.systemMessage ?? '',
      /not protected|not fully checked/u,
    );
  return updated;
}

test('load-sensitive fixture contract accepts only masking or explicit incomplete recovery', (t) => {
  const result = (answer) => ({
    status: 0,
    ms: 13001,
    stdout: JSON.stringify(answer),
  });
  assert.equal(
    checkMask(
      result({ systemMessage: 'tool output not fully checked' }),
      t,
      'notice contract',
      { allowTruncated: true },
    ),
    undefined,
  );
  for (const stdout of [
    '',
    '{}{}',
    JSON.stringify({
      hookSpecificOutput: { updatedToolOutput: { stdout: recoveryOnly } },
    }),
  ])
    assert.throws(() =>
      checkMask({ status: 0, ms: 1, stdout }, t, 'invalid contract', {
        allowTruncated: true,
      }),
    );
  assert.throws(() =>
    checkMask(
      result({ systemMessage: 'not protected: timed out' }),
      t,
      'timeout contract',
      { allowTruncated: true },
    ),
  );
});

for (const [label, text] of [
  ['sparse', sparse],
  ['cutoff sparse', cutoffSparse],
  ['minimal rows', minimal],
  ['repeated', dense],
])
  for (const command of [
    ['grep', '-rnH', '.', 'b.js'],
    ['rg', '-n', '--with-filename', '.', 'b.js'],
  ])
    test(
      `output recovery budget: ${label}/${command[0]}`,
      { skip: process.platform === 'win32' },
      (t) => {
        const project = tempProject({ env: false });
        const actualCommand =
          label === 'minimal rows' ? [...command.slice(0, -1), 'b'] : command;
        const stdout = fixtureOutput(project, actualCommand, text);
        const result = realHook(project, {
          tool_name: 'Bash',
          tool_input: { command: actualCommand.join(' ') },
          tool_response: { stdout, stderr: '', interrupted: false },
        });
        const updated = checkMask(result, t, `${label}/${command[0]}`, {
          truncated: true, // Unique transport prefixes exceed the unchanged 2 MiB work allowance.
          allowTruncated: true,
        });
        if (updated)
          assert.equal(
            updated.stdout.split('\n').length,
            stdout.split('\n').length,
            'transport retained',
          );
      },
    );

test(
  'loader stdout flush: sparse search through a piped subprocess',
  { skip: process.platform === 'win32' },
  (t) => {
    const project = tempProject({ env: false });
    const command = ['grep', '-rn', '.', 'b.js'];
    const stdout = fixtureOutput(project, command, sparse);
    const result = realHook(
      project,
      {
        tool_name: 'Bash',
        tool_input: { command: command.join(' ') },
        tool_response: { stdout, stderr: '', interrupted: false },
      },
      { piped: true },
    );
    const updated = checkMask(result, t, 'piped sparse grep', {
      allowTruncated: true,
    });
    assert.ok(result.stdout.endsWith('\n'), 'answer finished writing');
    if (updated)
      assert.equal(
        updated.stdout.split('\n').length,
        stdout.split('\n').length,
      );
  },
);

function loaderFixture(project, body) {
  const pluginDir = path.join(project.dir, 'loader-fixture');
  mkdirSync(path.join(pluginDir, 'hooks'), { recursive: true });
  mkdirSync(path.join(pluginDir, 'packages/zeroh-disclosure-core'), {
    recursive: true,
  });
  writeFileSync(path.join(pluginDir, 'package.json'), '{"type":"module"}');
  copyModuleFixture(PLUGIN, pluginDir, ['hooks/run.js', 'hooks/worker.js']);
  writeFileSync(path.join(pluginDir, 'hooks/post-tool-use.js'), body);
  return pluginDir;
}

test('WIN11 minimal loader fixture follows Windows imports before running its hook', () => {
  const project = tempProject({ env: false });
  const pluginDir = loaderFixture(
    project,
    `process.stdout.write(JSON.stringify({ systemMessage: 'ZEROHFAKE fixture ran' }) + '\\n');`,
  );
  const result = realHook(
    project,
    { tool_name: 'Bash', tool_response: 'ordinary' },
    {
      pluginDir,
      extraEnv: {
        NODE_OPTIONS:
          '--import=' +
          pathToFileURL(
            path.join(PLUGIN, 'test/tools/worker-child-process-preload.mjs'),
          ).href,
        ZEROH_WORKER_TEST_TRACE: path.join(project.dir, 'fixture-trace'),
      },
    },
  );
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    systemMessage: 'ZEROHFAKE fixture ran',
  });
  const status = JSON.parse(
    readFileSync(
      sessionStatusPath(project.dir, 'output-budget', {
        ...process.env,
        ZEROH_HOME: project.home,
      }),
      'utf8',
    ),
  );
  assert.ok(status.hooks['post-tool-use'].ok_at);
});

for (const mode of ['pass', 'block'])
  test(`WIN11 a missing hook import uses the designed loader fallback (${mode})`, () => {
    const project = tempProject({ env: false });
    const pluginDir = loaderFixture(
      project,
      `import './ZEROHFAKE-missing.js';`,
    );
    const result = realHook(
      project,
      { tool_name: 'Bash', tool_response: fake },
      {
        pluginDir,
        extraEnv: { ZEROH_UNCERTAIN: mode },
      },
    );
    assert.equal(result.status, 0);
    const answer = JSON.parse(result.stdout);
    if (mode === 'pass')
      assert.match(answer.systemMessage, /check failed: ERR_MODULE_NOT_FOUND/u);
    else {
      assert.match(
        answer.hookSpecificOutput.updatedToolOutput,
        /could not check.*withheld/u,
      );
      assert.ok(!result.stdout.includes(fake));
    }
  });

// Exercise the production hook and loader with deterministic recovery time.
// This changes no detector behavior and adds no wall-clock startup sleep.
function productionRecoveryFixture(project, probeBody) {
  const pluginDir = loaderFixture(project, '');
  const original = new URL(
    '../../packages/zeroh-disclosure-core/bash-output-context.js',
    import.meta.url,
  ).href;
  const probe = path.join(pluginDir, 'hooks/clock-probe.mjs');
  writeFileSync(
    probe,
    `import * as original from ${JSON.stringify(original)};
    export * from ${JSON.stringify(original)};
    ${probeBody}`,
  );
  const step = new URL(
    '../../lib/hook-steps/post-tool-use/recovery-notice.js',
    import.meta.url,
  );
  const stepFixture = path.join(pluginDir, 'hooks/recovery-step.mjs');
  writeFileSync(
    stepFixture,
    readFileSync(step, 'utf8').replace(
      /(['"])(\.\.\/[^'"]+)\1/gu,
      (_, quote, specifier) =>
        quote +
        (specifier.endsWith('/bash-output-context.js')
          ? pathToFileURL(probe).href
          : new URL(specifier, step).href) +
        quote,
    ),
  );
  const hook = new URL('../../hooks/post-tool-use.js', import.meta.url);
  writeFileSync(
    path.join(pluginDir, 'hooks/post-tool-use.js'),
    readFileSync(hook, 'utf8').replace(
      /(['"])(\.\.\/[^'"]+)\1/gu,
      (_, quote, specifier) =>
        quote +
        (specifier.endsWith('/bash-output-context.js')
          ? pathToFileURL(probe).href
          : specifier.endsWith('/recovery-notice.js')
            ? pathToFileURL(stepFixture).href
            : new URL(specifier, hook).href) +
        quote,
    ),
  );
  return pluginDir;
}

for (const estimate of [1800, 3000])
  test(`1.5x underestimated recovery leaves whole-hook margin (${estimate} ms estimate)`, (t) => {
    const project = tempProject({ env: false });
    const stats = path.join(project.dir, 'margin-stats');
    const pluginDir = productionRecoveryFixture(
      project,
      `
      import {writeFileSync} from 'node:fs';
      let budget, reads = 0;
      export function outputRecoveryBudget() {
        budget = original.outputRecoveryBudget({hookStart: 0, now: () => {
          if (++reads === 1) return 6000 - ${estimate};
          return 6000 + (budget?.detectorCalls ?? 0) * ${estimate} * 1.5;
        }});
        return budget;
      }
      process.on('exit', () => writeFileSync(${JSON.stringify(stats)}, JSON.stringify({
        deadline: budget.deadline, calls: budget.detectorCalls,
        // Include the production 2 s vault lock wait and the entire tail reserve.
        hookEnd: budget.now() + 2000 + budget.tailReserve(budget.outputBytes)
      })));
    `,
    );
    const stdout = 'const x = 1;\n'.repeat(69999) + `curl -u "admin:${fake}"\n`;
    const result = realHook(
      project,
      {
        tool_name: 'Bash',
        tool_input: { command: 'cat fake.js' },
        tool_response: { stdout },
      },
      { pluginDir },
    );
    assert.equal(result.status, 0);
    assert.equal(result.error, undefined);
    const answer = JSON.parse(result.stdout);
    assert.ok(
      !JSON.stringify(answer).includes(fake),
      'unknown protection retained',
    );
    const timing = JSON.parse(readFileSync(stats, 'utf8'));
    assert.ok(
      13000 - timing.hookEnd >= 1500,
      'whole hook has at least 1.5 s watchdog margin',
    );
    assert.equal(timing.deadline, 10500);
    assert.equal(timing.calls, estimate === 1800 ? 1 : 0);
    if (timing.calls)
      assert.doesNotMatch(answer.systemMessage ?? '', /not fully checked/u);
    else assert.match(answer.systemMessage, /not fully checked/u);
    t.diagnostic(
      `1.5x estimate/${estimate}: injected end ${timing.hookEnd.toFixed(1)} ms; watchdog margin ${(13000 - timing.hookEnd).toFixed(1)} ms; real wall ${result.ms.toFixed(1)} ms; load ${loadavg().join('/')}`,
    );
  });

for (const mode of ['pass', 'block'])
  for (const completedCalls of [0, 2])
    test(`truncated recovery after slow startup: ${mode}/${completedCalls} completed calls`, (t) => {
      const project = tempProject({ env: false });
      const pluginDir = productionRecoveryFixture(
        project,
        `
        export function outputRecoveryBudget() {
          let budget;
          budget = original.outputRecoveryBudget({hookStart: 0,
            now: () => budget?.detectorCalls >= ${completedCalls} ? 11400 : 9000});
          return budget;
        }
      `,
      );
      const stdout =
        'fake.js:1:password="fake.js:123:ZEROHFAKE7!"\n' +
        'other.js:2:password="other.js:456:ZEROHFAKE8!"\n';
      const result = realHook(
        project,
        {
          tool_name: 'Bash',
          tool_input: { command: 'rg -n . fake.js' },
          tool_response: { stdout },
        },
        { pluginDir, extraEnv: { ZEROH_UNCERTAIN: mode } },
      );
      t.diagnostic(
        `injected clock ${mode}/${completedCalls}: ${result.ms.toFixed(1)} ms; load ${loadavg().join('/')}`,
      );
      assert.equal(result.status, 0);
      assert.equal(result.error, undefined);
      assert.ok(
        result.stdout.length,
        'skipped recovery must answer even with no findings',
      );
      const json = JSON.parse(result.stdout); // exactly one JSON value
      if (mode === 'block') {
        assert.match(
          json.hookSpecificOutput.updatedToolOutput.stdout,
          /withheld|stopped/u,
        );
        assert.ok(!JSON.stringify(json).includes('ZEROH' + 'FAKE'));
      } else {
        assert.match(json.systemMessage, /not fully checked/u);
        if (completedCalls) {
          assert.ok(
            !json.hookSpecificOutput.updatedToolOutput.stdout.includes(
              recoveryOnly,
            ),
            'completed recovery mask kept',
          );
          assert.ok(
            json.hookSpecificOutput.updatedToolOutput.stdout.includes(
              'ZEROH' + 'FAKE8!',
            ),
            'unfinished recovery retained with notice',
          );
        }
      }
    });

test('cheap recovery completes after more than eight seconds of startup', (t) => {
  const project = tempProject({ env: false });
  const pluginDir = productionRecoveryFixture(
    project,
    `
    export const outputRecoveryBudget = () => original.outputRecoveryBudget({hookStart: 0, now: () => 9000});
  `,
  );
  const result = realHook(
    project,
    {
      tool_name: 'Grep',
      tool_input: { output_mode: 'content' },
      tool_response: {
        mode: 'content',
        content: 'fake.js:1:password="fake.js:123:ZEROHFAKE7!"\n',
      },
    },
    { pluginDir },
  );
  const json = JSON.parse(result.stdout);
  assert.ok(
    !json.hookSpecificOutput.updatedToolOutput.content.includes(recoveryOnly),
  );
  assert.doesNotMatch(json.systemMessage ?? '', /not fully checked/u);
  t.diagnostic(
    `cheap late recovery: ${result.ms.toFixed(1)} ms; load ${loadavg().join('/')}`,
  );
});

test('save fallback with a changed exact-vault rewrite marks lost recovery as truncated', async (t) => {
  const project = tempProject({ env: false });
  const { Vault } =
    await import('../../packages/zeroh-disclosure-core/vault.js');
  const vault = new Vault(project.dir, {
    env: { ...process.env, ZEROH_HOME: project.home },
  });
  vault.tokenFor('PASSWORD', recoveryOnly, 'detected', {
    matchScope: 'in-context',
  });
  vault.save();
  const stats = path.join(project.dir, 'fallback-stats');
  const pluginDir = productionRecoveryFixture(
    project,
    `
    import {writeFileSync} from 'node:fs';
    let calls = 0;
    export function scrubBashResponse(...args) {
      const result = original.scrubBashResponse(...args);
      if (++calls === 1) args[3].work = 0;
      else writeFileSync(${JSON.stringify(stats)}, JSON.stringify({truncated: args[3].truncated}));
      return result;
    }
  `,
  );
  const workerFile = path.join(pluginDir, 'hooks/worker.js');
  writeFileSync(
    workerFile,
    `import {Vault} from ${JSON.stringify(new URL('../../packages/zeroh-disclosure-core/vault.js', import.meta.url).href)};
    Vault.prototype.save = () => {throw new Error('forced fake save failure');};\n` +
      readFileSync(workerFile, 'utf8'),
  );
  const newValue = 'ZEROH' + 'FAKE9!';
  const result = realHook(
    project,
    {
      tool_name: 'Bash',
      tool_input: { command: 'rg -n . fake.js' },
      tool_response: {
        stdout: `curl -u "admin:${newValue}"\n`,
        output: `curl -u "admin:${newValue}"\nfake.js:1:password="${recoveryOnly}"\n`,
      },
    },
    { pluginDir },
  );
  const json = JSON.parse(result.stdout);
  assert.match(json.systemMessage, /couldn't save its vault/u);
  assert.match(json.systemMessage, /not fully checked/u);
  assert.equal(JSON.parse(readFileSync(stats, 'utf8')).truncated, true);
  assert.equal(
    json.hookSpecificOutput,
    undefined,
    'with no remaining masks, the original output passes with both notices',
  );
  t.diagnostic(
    `changed fallback: ${result.ms.toFixed(1)} ms; load ${loadavg().join('/')}`,
  );
});

const completeAnswer = `
  globalThis.zerohHook.state.emitted = true;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { updatedToolOutput: { stdout: 'x'.repeat(740000) } } }) + '\\n');
  process.exit(0);
`;

for (const mode of ['pass', 'block'])
  test(
    `loader stdout deadline: one complete answer through a slow pipe (${mode})`,
    { skip: process.platform === 'win32' },
    (t) => {
      const project = tempProject({ env: false });
      const pluginDir = loaderFixture(project, completeAnswer);
      const result = realHook(
        project,
        { tool_name: 'Bash', tool_response: { stdout: 'ordinary' } },
        {
          piped: true,
          delay: '2',
          pluginDir,
          extraEnv: { ZEROH_HOOK_DEADLINE_MS: '1500', ZEROH_UNCERTAIN: mode },
        },
      );
      t.diagnostic(
        `delayed pipe/${mode}: ${result.ms.toFixed(1)} ms; ${Buffer.byteLength(result.stdout)} stdout bytes; load ${loadavg().join('/')}`,
      );
      assert.equal(result.status, 0);
      const answer = JSON.parse(result.stdout);
      assert.equal(
        answer.hookSpecificOutput.updatedToolOutput.stdout.length,
        740000,
        'no queued output discarded',
      );
      assert.equal(answer.systemMessage, undefined, 'protective answer stands');
    },
  );

for (const mode of ['pass', 'block'])
  test(`loader deadline: incomplete answer is replaced once (${mode})`, (t) => {
    const project = tempProject({ env: false });
    const pluginDir = loaderFixture(
      project,
      `
    globalThis.zerohHook.state.emitted = true;
    process.stdout.write('{"hookSpecificOutput":');
    for (;;) {}
  `,
    );
    const result = realHook(
      project,
      { tool_name: 'Bash', tool_response: { stdout: 'ordinary' } },
      {
        pluginDir,
        extraEnv: { ZEROH_HOOK_DEADLINE_MS: '1500', ZEROH_UNCERTAIN: mode },
      },
    );
    t.diagnostic(
      `incomplete/${mode}: ${result.ms.toFixed(1)} ms; load ${loadavg().join('/')}`,
    );
    assert.equal(result.status, 0);
    const answer = JSON.parse(result.stdout);
    if (mode === 'block')
      assert.match(
        answer.hookSpecificOutput.updatedToolOutput.stdout,
        /was stopped.*timed out/u,
      );
    else assert.match(answer.systemMessage, /not protected.*timed out/u);
  });

test(
  'loader watchdog: stdout that never drains cannot keep the loader alive',
  { skip: process.platform === 'win32' },
  (t) => {
    const project = tempProject({ env: false });
    const pluginDir = loaderFixture(project, completeAnswer);
    const result = realHook(
      project,
      { tool_name: 'Bash', tool_response: { stdout: 'ordinary' } },
      {
        pluginDir,
        stalled: true,
        extraEnv: { ZEROH_HOOK_DEADLINE_MS: '1500' },
      },
    );
    t.diagnostic(
      `undrained stdout: ${result.ms.toFixed(1)} ms; load ${loadavg().join('/')}`,
    );
    assert.equal(
      result.error,
      undefined,
      'loader exited without the test killing it',
    );
    assert.equal(result.status, 0);
    assert.ok(
      result.ms < 4500,
      '1.5 s deadline + 1 s drain grace, with scheduling margin',
    );
  },
);

for (const unique of [false, true])
  for (const n of unique
    ? [300, 3000, 5000, 11000, 14000, 18000]
    : [300, 3000, 5000, 11000, 14000, 18000])
    test(`ordinary recovery: trailing credential after ${n} ${unique ? 'unique' : 'identical'} search rows`, (t) => {
      const project = tempProject({ env: false });
      const stdout =
        Array.from(
          { length: n },
          (_, i) => `${unique ? `a${i}` : 'a'}.js:${i + 1}:const x = 1;\n`,
        ).join('') + `fake.js:1:password="fake.js:123:${fake}"\n`;
      checkMask(
        realHook(project, {
          tool_name: 'Bash',
          tool_input: { command: 'rg -n . a.js fake.js' },
          tool_response: { stdout },
        }),
        t,
        `ordinary/${n}/${unique ? 'unique' : 'identical'}`,
        {
          allowTruncated:
            n >= 11000 && process.env.ZEROH_RECOVERY_REQUIRE_MASK !== '1',
        },
      );
    });

test('native Grep recovery: filename-shaped password', (t) => {
  const project = tempProject({ env: false });
  const result = realHook(project, {
    tool_name: 'Grep',
    tool_input: { pattern: '.', output_mode: 'content' },
    tool_response: {
      mode: 'content',
      content: `fake.js:1:password="fake.js:123:${fake}"`,
      numLines: 1,
    },
  });
  const updated = checkMask(result, t, 'native Grep');
  assert.ok(
    updated.content.startsWith('fake.js:1:password='),
    'filename prefix preserved',
  );
});

for (const mode of ['pass', 'block'])
  test(`clean empty worker exit ignores a later watchdog during slow recordRun (${mode})`, () => {
    const project = tempProject({ env: false });
    const pluginDir = loaderFixture(project, 'process.exit(0);');
    const core = path.join(pluginDir, 'packages/zeroh-disclosure-core');
    const countFile = path.join(project.dir, 'timeout-count');
    writeFileSync(
      path.join(core, 'uninstall-marker.js'),
      'export const hookStandsDown = () => false; export const isUninstalled = () => false;',
    );
    writeFileSync(
      path.join(core, 'session-status.js'),
      "let calls = 0; export const recordHookRun = () => { if (++calls > 1) throw new Error('forced bookkeeping failure'); };",
    );
    mkdirSync(path.join(pluginDir, 'packages/shell-analysis'), {
      recursive: true,
    });
    writeFileSync(
      path.join(pluginDir, 'packages/shell-analysis/late-bind.js'),
      'await new Promise(r => setTimeout(r, 250)); export const cleanupStaleRunFiles = () => {};',
    );
    writeFileSync(
      path.join(core, 'unchecked.js'),
      `import { writeFileSync } from 'node:fs'; export const recordUnchecked = () => { writeFileSync(${JSON.stringify(countFile)}, 'counted'); return { notice: 'timeout counted' }; };`,
    );
    const runFile = path.join(pluginDir, 'hooks/run.js');
    writeFileSync(
      runFile,
      readFileSync(runFile, 'utf8').replace(
        'within(recordRun(true), 300, undefined).finally',
        'setTimeout(() => fail(timeoutError(deadline)), 10); within(recordRun(true), 300, undefined).finally',
      ),
    );
    const result = realHook(
      project,
      { tool_name: 'Bash', tool_response: { stdout: 'ordinary' } },
      { pluginDir, extraEnv: { ZEROH_UNCERTAIN: mode } },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '', 'clean output needs no rewrite or notice');
    assert.equal(existsSync(countFile), false, 'no timeout counted');
  });

for (const waitMs of [0, 2000])
  for (const tool of ['Bash', 'Grep'])
    test(`vault save failure shares recovery budget on large ${tool} output (${waitMs} ms lock wait)`, async (t) => {
      const project = tempProject({ env: false });
      const { Vault, VAULT_LOCK, fileLockOwnerText } =
        await import('../../packages/zeroh-disclosure-core/vault.js');
      const vault = new Vault(project.dir, {
        env: { ...process.env, ZEROH_HOME: project.home },
      });
      vault.tokenFor('PASSWORD', fake, 'test');
      vault.tokenFor('PASSWORD', recoveryOnly, 'detected', {
        matchScope: 'in-context',
      });
      assert.equal(
        detectSensitiveData(`fake.js:1:password="${recoveryOnly}"\n`, {
          profile: 'tool',
        }).length,
        0,
        'saved fixture is found only by recovery',
      );
      vault.save();
      const pluginDir = loaderFixture(project, '');
      const statsFile = path.join(project.dir, 'recovery-stats');
      const probeFile = path.join(pluginDir, 'hooks/recovery-probe.mjs');
      const secretsProbe = path.join(pluginDir, 'hooks/secrets-probe.mjs');
      writeFileSync(
        secretsProbe,
        `
      import * as original from ${JSON.stringify(new URL('../../packages/shell-analysis/secrets.js', import.meta.url).href)};
      import { createHash } from 'node:crypto';
      import { detectSensitiveData } from ${JSON.stringify(new URL('../../packages/zeroh-disclosure-core/detector.js', import.meta.url).href)};
      export * from ${JSON.stringify(new URL('../../packages/shell-analysis/secrets.js', import.meta.url).href)};
      globalThis.detectionPasses = [];
      export function scrubDeep(value, options, ...rest) {
        return original.scrubDeep(value, {...options, detectFindings: (text, opts) => {
          const findings = (options.detectFindings ?? detectSensitiveData)(text, opts);
          globalThis.detectionPasses.at(-1).push({input: createHash('sha256').update(JSON.stringify([text, opts])).digest('hex'), findings});
          return findings;
        }}, ...rest);
      }
    `,
      );
      const original = new URL(
        '../../packages/zeroh-disclosure-core/bash-output-context.js',
        import.meta.url,
      ).href;
      writeFileSync(
        probeFile,
        `
    import * as original from ${JSON.stringify(original)};
    import { writeFileSync } from 'node:fs';
    export * from ${JSON.stringify(original)};
    const budgets = [], work = [];
    function probe(name, args, index) {
      budgets.push(args[index]);
      globalThis.detectionPasses.push([]);
      const result = original[name](...args);
      work.push(args[index]?.workUsed);
      return result;
    }
    export function scrubBashResponse(...args) { return probe('scrubBashResponse', args, 3); }
    export function scrubGrepResponse(...args) { return probe('scrubGrepResponse', args, 2); }
    process.on('exit', () => writeFileSync(${JSON.stringify(statsFile)}, JSON.stringify({
      calls: budgets.length, present: budgets.every(Boolean), shared: budgets[0] === budgets[1], work, passes: globalThis.detectionPasses
    })));
  `,
      );
      const productionHook = new URL(
        '../../hooks/post-tool-use.js',
        import.meta.url,
      );
      const body = readFileSync(productionHook, 'utf8').replace(
        /(['"])(\.\.\/[^'"]+)\1/gu,
        (_, quote, specifier) =>
          quote +
          (specifier.endsWith('/bash-output-context.js')
            ? pathToFileURL(probeFile).href
            : specifier.endsWith('/secrets.js')
              ? pathToFileURL(secretsProbe).href
              : new URL(specifier, productionHook).href) +
          quote,
      );
      writeFileSync(path.join(pluginDir, 'hooks/post-tool-use.js'), body);
      const workerFile = path.join(pluginDir, 'hooks/worker.js');
      const lockFile = path.join(project.dir, 'contended-vault.lock');
      writeFileSync(lockFile, fileLockOwnerText());
      writeFileSync(
        workerFile,
        `import { Vault, acquireFileLock, VAULT_LOCK } from ${JSON.stringify(new URL('../../packages/zeroh-disclosure-core/vault.js', import.meta.url).href)};
    Vault.prototype.save = function () { if (${waitMs}) acquireFileLock(${JSON.stringify(lockFile)}, VAULT_LOCK); throw new Error('forced test save failure'); };\n` +
          readFileSync(workerFile, 'utf8'),
      );
      const stdout =
        'fake.js:1:password="fake.js:123:ZEROHFAKE8!"\n' +
        `fake.js:1:password="${recoveryOnly}"\n` +
        fixtureOutput(
          project,
          ['rg', '-n', '--with-filename', '.', 'b.js'],
          cutoffSparse,
        );
      const result = realHook(
        project,
        {
          tool_name: tool,
          tool_input:
            tool === 'Bash'
              ? { command: 'rg -n --with-filename . b.js' }
              : { output_mode: 'content' },
          tool_response:
            tool === 'Bash' ? { stdout } : { mode: 'content', content: stdout },
        },
        { pluginDir },
      );
      const updated = checkMask(result, t, `forced save failure/${tool}`, {
        saveFailure: true,
        allowTruncated: true,
      });
      const answer = JSON.parse(result.stdout);
      const stats = JSON.parse(readFileSync(statsFile, 'utf8'));
      if (!/couldn't save its vault/u.test(answer.systemMessage ?? '')) {
        assert.match(answer.systemMessage, /not fully checked/u);
        assert.equal(
          stats.calls,
          1,
          'no unsaved findings means no vault save fallback',
        );
        return;
      }
      assert.ok(
        updated,
        'saved values still have a masking answer after fallback',
      );
      assert.ok(
        JSON.stringify(updated).includes('ZEROH' + 'FAKE8!'),
        'new unsaved value follows Rule 8',
      );
      if (!/not fully checked/u.test(answer.systemMessage ?? ''))
        assert.ok(
          !JSON.stringify(updated).includes(recoveryOnly),
          'completed recovery of a saved value stays masked after fallback',
        );
      assert.equal(
        VAULT_LOCK.waitMs,
        2000,
        'contention fixture uses production lock wait',
      );
      assert.equal(stats.calls, 2, 'actual save fallback masks again');
      assert.deepEqual(
        stats.passes[1],
        stats.passes[0],
        'same text/options reuse exactly equivalent findings, including recovery',
      );
      assert.equal(
        stats.work[1],
        stats.work[0],
        'fallback spends no recovery work',
      );
      assert.ok(
        stats.present && stats.shared,
        'both calls receive the same budget',
      );
      assert.ok(
        stats.work[1] >= stats.work[0] && stats.work[1] <= 2097152,
        'combined work bound',
      );
    });

test('cat recovery: approximately 910 KB code file stays under the hook bound', (t) => {
  const project = tempProject({ env: false });
  const stdout = 'const x = 1;\n'.repeat(69999) + `curl -u "admin:${fake}"\n`;
  assert.ok(
    Buffer.byteLength(stdout) > 910000 && Buffer.byteLength(stdout) < 911000,
  );
  checkMask(
    realHook(project, {
      tool_name: 'Bash',
      tool_input: { command: 'cat fake.js' },
      tool_response: { stdout },
    }),
    t,
    'cat/910 KB',
    { allowTruncated: true },
  );
});

test('loader worker deadline survives an independent worker clock origin', () => {
  const project = tempProject({ env: false });
  const pluginDir = loaderFixture(
    project,
    `
    const elapsed = performance.now() - globalThis.zerohHook.hookStart;
    process.stdout.write(JSON.stringify({elapsed}));
  `,
  );
  const workerFile = path.join(pluginDir, 'hooks/worker.js');
  writeFileSync(
    workerFile,
    `
    const originalNow = performance.now.bind(performance);
    Object.defineProperty(performance, 'timeOrigin', {value: performance.timeOrigin + 60000});
    Object.defineProperty(performance, 'now', {value: () => originalNow() - 60000});
  ` + readFileSync(workerFile, 'utf8'),
  );
  const result = realHook(
    project,
    { tool_name: 'Bash', tool_response: { stdout: 'ordinary' } },
    { pluginDir },
  );
  assert.equal(result.status, 0);
  const { elapsed } = JSON.parse(result.stdout);
  assert.ok(
    elapsed >= 0 && elapsed < 12500,
    'worker recovers loader epoch in its own clock',
  );
});

test('measure masking, vault and audit tail at the 1 MiB cutoff', (t) => {
  const project = tempProject({ env: false });
  const stats = path.join(project.dir, 'tail-stats');
  const pluginDir = productionRecoveryFixture(
    project,
    `
    import {writeFileSync} from 'node:fs';
    let end;
    export function memoizeOutputFindings(detector, options) {
      const memo = original.memoizeOutputFindings(detector, options);
      return (...args) => {const result = memo(...args); end = performance.now(); return result;};
    }
    process.on('exit', () => writeFileSync(${JSON.stringify(stats)}, JSON.stringify({tailMs: performance.now() - end})));
  `,
  );
  const stdout = 'const x = 1; '.repeat(80650) + `curl -u "admin:${fake}"\n`;
  assert.ok(Buffer.byteLength(JSON.stringify({ stdout })) < 1048576);
  assert.ok(Buffer.byteLength(stdout) > 1048000);
  const result = realHook(
    project,
    {
      tool_name: 'Bash',
      tool_input: { command: 'cat fake.js' },
      tool_response: { stdout },
    },
    { pluginDir },
  );
  checkMask(result, t, '1 MiB tail fixture', { allowTruncated: true });
  t.diagnostic(
    `mask/vault/audit tail: ${JSON.parse(readFileSync(stats, 'utf8')).tailMs.toFixed(1)} ms; load ${loadavg().join('/')}`,
  );
});
