// SPDX-License-Identifier: AGPL-3.0-only

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { availableParallelism } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateCorpus, TOKEN, VALUE, summarizeCorpus } from './corpus.mjs';
import { destinationFingerprints } from './gate.mjs';
import { freshEnvironment } from './isolation.mjs';
import { spawnFile } from '../parsers/process-files.mjs';

const PLUGIN = fileURLToPath(new URL('../../../', import.meta.url));
const sanitize = (text, value = VALUE) =>
  String(text ?? '')
    .replaceAll(value, '<restored>')
    .replace(/\[[A-Z][A-Z0-9_]*-[a-f0-9]+\]/gu, '<restored>');
const normalizedHosts = (hosts) =>
  [...new Set(hosts.map((host) => String(host).toLowerCase()))].sort();

export function writeCaseFixtures(project, fixtures = {}) {
  const target = (name) => {
    const resolved = path.resolve(project, name);
    if (!resolved.startsWith(project + path.sep))
      throw new Error('Fixture escapes isolated project');
    mkdirSync(path.dirname(resolved), { recursive: true });
    return resolved;
  };
  for (const [name, content] of Object.entries(fixtures.files ?? {}))
    writeFileSync(target(name), content);
  for (const name of fixtures.executables ?? []) chmodSync(target(name), 0o755);
  for (const [archive, entries] of Object.entries(fixtures.archives ?? {})) {
    const blocks = [];
    for (const [name, content] of Object.entries(entries)) {
      if (name.length > 99 || name.includes('..') || path.isAbsolute(name))
        throw new Error('Invalid isolated archive member');
      const bytes = Buffer.from(content);
      const header = Buffer.alloc(512);
      header.write(name, 0, 100);
      header.write('0000644\0', 100, 8);
      header.write('0000000\0', 108, 8);
      header.write('0000000\0', 116, 8);
      header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124, 12);
      header.write('00000000000\0', 136, 12);
      header.fill(32, 148, 156);
      header.write('0', 156, 1);
      header.write('ustar\0', 257, 6);
      header.write('00', 263, 2);
      const checksum = header.reduce((sum, byte) => sum + byte, 0);
      header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
      blocks.push(
        header,
        bytes,
        Buffer.alloc((512 - (bytes.length % 512)) % 512),
      );
    }
    blocks.push(Buffer.alloc(1024));
    writeFileSync(target(archive), Buffer.concat(blocks));
  }
}

export function classifyCase(row, observed) {
  if (observed.error)
    return { classification: 'untriaged', reason: observed.error };
  const wanted = row.expected.outcome;
  if (
    wanted === 'deny' &&
    row.expected.effect === 'protection' &&
    observed.outcome !== 'deny'
  )
    return {
      classification: 'missed-protection',
      reason: '1.0 does not stop a mandatory protection mutation',
    };
  if (observed.outcome === 'deny' && wanted !== 'deny')
    return {
      classification: 'false-stop',
      reason: '1.0 stops an independently allowed or local command',
    };
  if (wanted === 'deny' && observed.outcome !== 'deny' && !observed.notice)
    return {
      classification: 'missed-protection',
      reason:
        '1.0 allows independently disallowed value delivery without a notice',
    };
  if (
    observed.missingHosts?.length &&
    !observed.notice &&
    observed.outcome !== 'deny'
  )
    return {
      classification: 'missed-protection',
      reason:
        '1.0 does not name every independent destination and emits no notice',
    };
  if (wanted === 'notice' && !observed.notice && observed.outcome !== 'deny')
    return {
      classification: 'notice-gap',
      reason: 'unresolved destination effects pass without the required notice',
    };
  if (observed.outcome === 'notice' && !observed.receipt)
    return {
      classification: 'receipt-gap',
      reason: 'notice has no recorded unchecked reason',
    };
  return {
    classification: 'correct',
    reason: observed.notice
      ? 'uncertainty disclosed and recorded'
      : '1.0 agrees with independent outcome',
  };
}

export function recordedReasons(root, tool) {
  const counts = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (/^turn-.*\.json$/u.test(entry.name)) {
        const turn = JSON.parse(readFileSync(target, 'utf8'));
        for (const [reason, tools] of Object.entries(
          turn.audit?.unchecked ?? {},
        )) {
          const key = `${target}\0${reason}`;
          const count = Number(tools[tool] ?? 0);
          if (count > 0) counts.set(key, { reason, count });
        }
      }
    }
  }
  visit(root);
  return counts;
}

export async function observeCase(
  row,
  {
    analyzer,
    pluginSource = PLUGIN,
    executeHook,
    runHook = hookWithInput,
  } = {},
) {
  row = {
    ...row,
    expected: row.expectedByPlatform?.[process.platform] ?? row.expected,
  };
  const fixture = freshEnvironment('differential');
  const project = path.join(fixture.root, 'project');
  mkdirSync(project);
  const env = {
    ...fixture.env,
    ZEROH_PROXY: 'off',
    ZEROH_UNCERTAIN: 'pass',
    ZEROH_PUBLISHED_VERSION_CHECK: 'off',
    ZEROH_PHONE_REGION: 'none',
    CLAUDE_CODE_SHELL: row.shell === 'zsh' ? 'zsh' : 'bash',
  };
  const state = env.ZEROH_HOME;
  const settings = env.ZEROH_CLAUDE_SETTINGS;
  try {
    writeCaseFixtures(project, row.fixtures);
    const load = (relative) =>
      import(pathToFileURL(path.join(pluginSource, relative)).href);
    const [
      { shellDestinations },
      { hostsIn, networkHostsIn, destinationText },
      { Vault },
      { writeAllowRules },
    ] = await Promise.all([
      load('packages/shell-analysis/shell-destinations.js'),
      load('packages/shell-analysis/secrets.js'),
      load('packages/zeroh-disclosure-core/vault.js'),
      load('packages/zeroh-disclosure-core/allow-rules.js'),
    ]);
    const value = row.restoredValue ?? VALUE;
    const vault = new Vault(project, { env });
    const token = vault.tokenFor(
      row.valueType ?? row.type ?? 'API_KEY',
      value,
      'known:DESTINATION',
    );
    vault.save();
    writeAllowRules(
      project,
      { DESTINATION: row.allowedHosts ?? [] },
      { home: state },
    );
    writeFileSync(
      path.join(state, 'statusline.json'),
      JSON.stringify({
        v: 1,
        choices: { [path.resolve(settings)]: { choice: 'off' } },
        paths: [],
      }),
    );
    let command = row.command.replaceAll(TOKEN, token);
    if (row.category === 'spike-42')
      command = command.replace(/\bT\b/gu, token).replaceAll('\\n', '\n');
    // Variant 1 restores reference-looking bytes into a literal shell word.
    if (row.finding === 'FINDINGS9-variant1')
      command = command.replaceAll('$STRIPE_KEY:', token);
    if (row.shell === 'cmd')
      command = `cmd /d /s /c '${command.replaceAll("'", "'\\''")}'`;
    const shell = ['pwsh', 'powershell', 'powershell-5.1'].includes(row.shell)
      ? 'powershell'
      : 'bash';
    const toolName = shell === 'powershell' ? 'PowerShell' : 'Bash';
    const found = (analyzer ?? shellDestinations)(command, { shell });
    const named = normalizedHosts(
      [
        ...found.destinations,
        ...hostsIn(destinationText(toolName, { command })),
        ...networkHostsIn(command, { shell }),
      ].map((host) => host.replaceAll(token, value)),
    );
    const delivered =
      row.valuePresent === false ||
      row.expected.effect === 'local-key' ||
      row.expected.effect === 'local'
        ? []
        : normalizedHosts(row.expected.hosts ?? []);
    const missingHosts = delivered.filter((host) => !named.includes(host));
    const extraHosts = named.filter((host) => !delivered.includes(host));
    // Use a dedicated stdin-driven hook process; no command is executed by this differential.
    await runHook(
      env,
      project,
      {
        session_id: 'destination-43',
        cwd: project,
        prompt: 'Run the isolated destination corpus case.',
      },
      'user-prompt-submit',
      pluginSource,
    );
    const receiptBefore = recordedReasons(state, toolName);
    const hook = await runHook(
      env,
      project,
      {
        session_id: 'destination-43',
        cwd: project,
        tool_use_id: row.id,
        tool_name: toolName,
        tool_input: { command },
      },
      'pre-tool-use',
      pluginSource,
    );
    const output = hook.stdout.trim()
      ? JSON.parse(hook.stdout.trim().split('\n').at(-1))
      : {};
    const denied = output.hookSpecificOutput?.permissionDecision === 'deny';
    const notice =
      /not protected|ran unchecked|couldn't check|cannot check/iu.test(
        output.systemMessage ?? '',
      )
        ? sanitize(output.systemMessage, value)
        : '';
    const outcome = denied ? 'deny' : notice ? 'notice' : 'allow';
    const receiptAfter = recordedReasons(state, toolName);
    const noticeReasons = [
      ...new Set(
        [...receiptAfter]
          .filter(
            ([key, entry]) =>
              entry.count > (receiptBefore.get(key)?.count ?? 0),
          )
          .map(([, entry]) => entry.reason),
      ),
    ].sort();
    const observed = {
      outcome,
      notice,
      receipt: noticeReasons.length > 0,
      noticeReasons,
      execution:
        row.shell === 'cmd' ? 'cmd /d /s /c via Bash tool' : `${toolName} tool`,
      missingHosts: missingHosts.map((host) => sanitize(host, value)),
      extraHosts: extraHosts.map((host) => sanitize(host, value)),
      hosts: named.map((host) => sanitize(host, value)),
    };
    const executionEffect =
      executeHook && !denied
        ? await executeHook({
            command:
              output.hookSpecificOutput?.updatedInput?.command ?? command,
            env,
            cwd: project,
          })
        : undefined;
    return {
      executionEffect,
      id: row.id,
      program: row.program,
      spelling: row.spelling,
      shell: row.shell,
      expectedOutcome: row.expected.outcome,
      observedVia: 'real-pre-tool-use',
      ...observed,
      ...classifyCase(row, observed),
    };
  } catch (error) {
    const timedOut = error.code === 'ETIMEDOUT';
    return {
      id: row.id,
      program: row.program,
      spelling: row.spelling,
      shell: row.shell,
      ...(timedOut
        ? { observationStatus: 'timeout', reason: 'hook timeout' }
        : {
            classification: 'untriaged',
            reason: 'hook or analyzer observation failed',
          }),
      notice: '',
    };
  } finally {
    fixture.cleanup();
  }
}

export async function hookWithInput(
  env,
  cwd,
  event,
  hookName = 'pre-tool-use',
  pluginSource = PLUGIN,
  timeout = 20000,
) {
  const result = await spawnFile(
    process.execPath,
    [path.join(pluginSource, 'hooks/run.js'), hookName],
    { env, cwd, input: JSON.stringify(event), timeout },
  );
  if (result.signal === 'SIGTERM' || result.error?.code === 'ETIMEDOUT') {
    const error = new Error('hook timeout');
    error.code = 'ETIMEDOUT';
    throw error;
  }
  if (result.signal || result.status !== 0) throw new Error('hook failed');
  return result;
}

export async function runDifferential({
  rows = generateCorpus(),
  legs = [],
  analyzer,
  observe = observeCase,
  concurrency = Math.min(4, availableParallelism()),
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw new Error('differential concurrency must be an integer from 1 to 4');
  const cases = new Array(rows.length);
  let next = 0;
  // Each observation creates and removes its own home, vault and TMPDIR.
  // Workers store results by input index, never completion order. Cold parser
  // benchmarks finish before this pool starts; no suite overlaps this run.
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < rows.length) {
        const index = next++;
        cases[index] = await observe(rows[index], { analyzer });
      }
    }),
  );
  // Drain the entire worker pool before retrying timed-out rows, one at a time.
  // A timeout is an infrastructure observation, never a policy classification.
  const timeouts = [];
  for (let index = 0; index < cases.length; index++) {
    if (cases[index].observationStatus !== 'timeout') continue;
    cases[index] = await observe(rows[index], { analyzer });
    timeouts.push({
      id: rows[index].id,
      attempts: 2,
      recovered:
        cases[index].observationStatus !== 'timeout' &&
        cases[index].classification !== 'untriaged',
    });
  }
  const counts = cases.reduce((result, entry) => {
    const key =
      entry.observationStatus === 'timeout' ? 'timeout' : entry.classification;
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
  return {
    schemaVersion: 1,
    baseline: 'split 1.0 analyzer before phase 44',
    ...destinationFingerprints(PLUGIN),
    corpus: summarizeCorpus(rows),
    cases,
    ...(timeouts.length ? { timeouts } : {}),
    legs,
    counts,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const index = process.argv.indexOf('--output');
  if (index < 0 || !process.argv[index + 1])
    throw new Error('usage: differential.mjs --output <report.json>');
  const concurrencyIndex = process.argv.indexOf('--concurrency');
  const report = await runDifferential(
    concurrencyIndex < 0
      ? {}
      : {
          concurrency: Number(process.argv[concurrencyIndex + 1]),
        },
  );
  writeFileSync(
    process.argv[index + 1],
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({ corpus: report.corpus, classifications: report.counts }),
  );
}
