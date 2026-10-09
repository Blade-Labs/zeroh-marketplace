// SPDX-License-Identifier: AGPL-3.0-only

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  REQUIRED_LEGS,
  REQUIRED_NODES,
  releaseSourceCommit,
  readDestinationEvidence,
  validateDestinationSource,
  applicableOraclePending,
  validateDestinationObservations,
  FULL_DESTINATION_MATRIX,
} from '../test/shell-analysis/destinations/gate.mjs';
import { safeDiagnosticText } from '../test/shell-analysis/parsers/process-files.mjs';
import { windowsFixtureTool } from '../test/shell-analysis/destinations/windows-tools.mjs';

const pluginRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const destinationRoot = path.join(
  pluginRoot,
  'test/shell-analysis/destinations',
);

export function planDestinationLeg(
  platform,
  node,
  architecture = process.arch,
) {
  if (
    !Object.hasOwn(REQUIRED_LEGS, platform) ||
    !REQUIRED_NODES.includes(String(node))
  )
    throw new Error('unsupported destination CI leg');
  return REQUIRED_LEGS[platform].map((shell) => ({
    shell,
    executable:
      platform === 'macos' && shell === 'bash-3.2'
        ? '/bin/bash'
        : platform === 'macos' && shell === 'bash'
          ? architecture === 'arm64'
            ? '/opt/homebrew/bin/bash'
            : '/usr/local/bin/bash'
          : shell === 'git-bash'
            ? 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
            : shell === 'powershell-5.1'
              ? 'powershell.exe'
              : shell === 'cmd'
                ? 'cmd.exe'
                : shell,
  }));
}

export function requireDestinationShells(plan, probe = spawnSync) {
  for (const { shell, executable } of plan) {
    const args =
      shell === 'cmd'
        ? ['/d', '/s', '/c', 'exit 0']
        : ['pwsh', 'powershell-5.1'].includes(shell)
          ? [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              '$PSVersionTable.PSVersion.ToString()',
            ]
          : ['--version'];
    const result = probe(executable, args, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0)
      throw Object.assign(
        new Error(`required destination shell missing: ${shell}`),
        {
          diagnostics: [
            {
              oracle: 'shell-probe',
              shell,
              caseIds: ['availability'],
              message: `required destination shell missing: ${shell}`,
              commands: [
                {
                  program: path.basename(executable),
                  status: result.status ?? null,
                  stderr: safeDiagnosticText(
                    result.stderr || result.error?.code,
                  ),
                },
              ],
            },
          ],
        },
      );
    if (shell === 'bash-3.2' && !/version 3\.2\./u.test(result.stdout ?? ''))
      throw new Error('required destination shell version differs: bash-3.2');
    if (
      shell === 'powershell-5.1' &&
      !/^5\.1\./u.test((result.stdout ?? '').trim())
    )
      throw new Error(
        'required destination shell version differs: powershell-5.1',
      );
    if (shell === 'pwsh' && !/^7\./u.test((result.stdout ?? '').trim()))
      throw new Error('required destination shell version differs: pwsh');
  }
}

export function mergeDestinationReports(reports) {
  if (!reports.length) throw new Error('no destination CI reports');
  if (
    reports.some(
      (report) => report.status === 'failed' || report.partial === true,
    )
  )
    throw new Error('failed partial destination CI reports cannot be merged');
  const first = reports[0];
  const ids = first.cases.map((entry) => entry.id).sort();
  for (const report of reports) {
    if (
      report.sourceCommit !== first.sourceCommit ||
      report.corpusHash !== first.corpusHash ||
      report.analyzerHash !== first.analyzerHash ||
      report.runtimeHash !== first.runtimeHash ||
      JSON.stringify(report.cases.map((entry) => entry.id).sort()) !==
        JSON.stringify(ids)
    )
      throw new Error('destination CI reports disagree on corpus or analyzer');
    if (
      new Set(report.cases.map((entry) => entry.id)).size !==
      report.cases.length
    )
      throw new Error('destination CI report contains duplicate cases');
    if (
      !/^[a-f0-9]{40}$/u.test(report.sourceCommit ?? '') ||
      report.observationProvenance?.reusedRows !== 0 ||
      report.legs.some(
        (leg) =>
          leg.commitSha !== report.sourceCommit ||
          typeof leg.ciRunId !== 'string' ||
          !/^[0-9]+$/u.test(leg.ciRunId) ||
          leg.observationsRegenerated !== true,
      )
    )
      throw new Error(
        'destination CI report lacks commit/run provenance or reused observations',
      );
    for (const entry of report.cases) {
      const canonical = first.cases.find((row) => row.id === entry.id);
      if (
        ['program', 'spelling', 'shell'].some(
          (key) => entry[key] !== canonical[key],
        )
      )
        throw new Error('destination CI reports disagree on case metadata');
    }
  }
  const triage = readDestinationEvidence(destinationRoot);
  const releaseVersion = JSON.parse(
    readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'),
  ).version;
  for (const report of reports) {
    const errors = validateDestinationObservations({
      ...triage,
      differential: report,
      releaseVersion,
    });
    if (errors.length)
      throw new Error(`destination leg verdict failed: ${errors.join('; ')}`);
  }
  const severity = {
    correct: 0,
    'notice-gap': 1,
    'receipt-gap': 1,
    'parser-disagreement': 2,
    untriaged: 4,
    'missed-protection': 2,
    'false-stop': 3,
  };
  const cases = first.cases.map((entry) => {
    const observations = reports.map((report) => ({
      legs: report.legs.map(({ platform, node }) => `${platform}/${node}`),
      ...report.cases.find((row) => row.id === entry.id),
    }));
    const chosen = [...observations].sort(
      (a, b) =>
        (severity[b.classification] ?? 4) - (severity[a.classification] ?? 4),
    )[0];
    const unresolved = observations.filter(
      (row) => row.classification !== 'correct',
    );
    const notice = unresolved.some((row) => !row.notice) ? '' : chosen.notice;
    const result = { ...chosen };
    if (
      result.observationStatus !== 'timeout' &&
      !Object.hasOwn(severity, result.classification)
    )
      result.classification = 'untriaged';
    delete result.legs;
    return { ...result, notice, observationsByLeg: observations };
  });
  const counts = cases.reduce((totals, row) => {
    const key =
      row.observationStatus === 'timeout' ? 'timeout' : row.classification;
    totals[key] = (totals[key] ?? 0) + 1;
    return totals;
  }, {});
  return {
    ...first,
    cases,
    counts,
    timeouts: reports.flatMap((report) =>
      (report.timeouts ?? []).map((timeout) => ({
        ...timeout,
        legs: [
          ...new Set(
            report.legs.map(({ platform, node }) => `${platform}/${node}`),
          ),
        ],
      })),
    ),
    legs: reports.flatMap((report) => report.legs),
    parserTimings: reports.flatMap((report) => report.parserTimings ?? []),
    oracles: reports.flatMap((report) => report.oracles ?? []),
    oracleRequirementsChecked: reports.every(
      (report) => report.oracleRequirementsChecked === true,
    ),
    unresolvedOracles: [
      ...new Set(
        reports.flatMap((report) => {
          const platform = report.legs[0]?.platform;
          return applicableOraclePending(
            platform,
            report.unresolvedOracles ?? [],
          );
        }),
      ),
    ],
  };
}

export function writeFailedDestinationReport(
  { output, platform, node, sourceCommit, ciRunId, plan, oracle, error },
  log = console.error,
) {
  const diagnostics = [
    ...(oracle?.diagnostics ?? []),
    ...(error.diagnostics ?? []),
  ];
  for (const diagnostic of diagnostics) {
    log(
      `destination oracle=${diagnostic.oracle} shell=${diagnostic.shell} cases=${diagnostic.caseIds.join(',')}: ${safeDiagnosticText(diagnostic.message)}`,
    );
    for (const command of diagnostic.commands ?? [])
      log(
        `  program=${command.program} exit=${command.status} signal=${command.signal ?? 'none'} elapsedMs=${command.elapsedMs ?? 'unknown'} stderr:\n${safeDiagnosticText(command.stderr) || '(empty)'}`,
      );
  }
  for (const failure of oracle?.failures ?? [])
    log(
      `destination oracle failure (${plan.map(({ shell }) => shell).join(',')}): ${safeDiagnosticText(failure)}`,
    );
  if (!diagnostics.length)
    log(
      `destination oracle=setup shell=${plan.map(({ shell }) => shell).join(',')} cases=availability: ${safeDiagnosticText(error.message)}`,
    );
  const report = {
    status: 'failed',
    partial: true,
    sourceCommit,
    failure: safeDiagnosticText(error.message),
    diagnostics,
    cases: [],
    legs: plan.map(({ shell }) => ({
      platform,
      node,
      shell,
      commitSha: sourceCommit,
      ciRunId,
      status: 'failed',
      oraclePassed: false,
      observationsRegenerated: false,
    })),
    oracles: oracle ? [{ ...oracle, platform, node }] : [],
    oracleRequirementsChecked: false,
  };
  mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function runNode(args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: pluginRoot,
    env,
    encoding: 'utf8',
    timeout: 60 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0)
    throw Object.assign(
      new Error(`destination CI subprocess failed: ${path.basename(args[0])}`),
      {
        diagnostics: [
          {
            oracle: 'collection',
            shell: args.includes('--shell')
              ? args[args.indexOf('--shell') + 1]
              : 'node',
            caseIds: [path.basename(args[0])],
            message: 'destination CI subprocess failed',
            commands: [
              {
                program: 'node',
                status: result.status ?? null,
                stderr: safeDiagnosticText(result.stderr || result.error?.code),
              },
            ],
          },
        ],
      },
    );
}

export async function collectDestinationLeg({
  platform,
  node,
  output,
  ciRunId = process.env.GITHUB_RUN_ID,
}) {
  if (
    { linux: 'ubuntu', darwin: 'macos', win32: 'windows' }[process.platform] !==
    platform
  )
    throw new Error('destination CI platform differs from the selected leg');
  const plan = planDestinationLeg(platform, node);
  const actualNode = process.versions.node;
  if (!(node === '22' ? actualNode.startsWith('22.') : actualNode === node))
    throw new Error(
      'destination CI Node version differs from the selected leg',
    );
  const sourceCommit = releaseSourceCommit(pluginRoot);
  if (typeof ciRunId !== 'string' || !/^[0-9]+$/u.test(ciRunId))
    throw new Error('destination CI run id is required');
  const isolationRoot = path.join(
    process.env.TMPDIR || os.tmpdir(),
    'zeroh-destination-ci',
  );
  mkdirSync(isolationRoot, { recursive: true });
  const temporary = mkdtempSync(path.join(isolationRoot, 'destination-ci-'));
  const bin = path.join(temporary, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexit 0\n');
  chmodSync(path.join(bin, 'claude'), 0o755);
  writeFileSync(path.join(bin, 'claude.cmd'), '@exit /b 0\r\n');
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    SystemRoot: process.env.SystemRoot ?? '',
    HOME: path.join(temporary, 'home'),
    USERPROFILE: path.join(temporary, 'home'),
    ZEROH_HOME: path.join(temporary, 'zeroh'),
    ZEROH_CREDENTIAL_HOME: path.join(temporary, 'credentials'),
    CLAUDE_CONFIG_DIR: path.join(temporary, 'claude'),
    ZEROH_CLAUDE_SETTINGS: path.join(temporary, 'claude/settings.json'),
    ZEROH_SERVICE_MANAGER_DIR: path.join(temporary, 'services'),
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
  };
  for (const key of [
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'ZEROH_ORACLE_BRIDGE_DIAGNOSTICS',
  ])
    if (process.env[key]) env[key] = process.env[key];
  for (const directory of [
    env.HOME,
    env.ZEROH_HOME,
    env.ZEROH_CREDENTIAL_HOME,
    env.CLAUDE_CONFIG_DIR,
    env.ZEROH_SERVICE_MANAGER_DIR,
    env.TMPDIR,
  ])
    mkdirSync(directory, { recursive: true });
  let oracle;
  const timings = [];
  const timed = async (stage, run) => {
    console.error(`destination stage=${stage} started`);
    const start = performance.now();
    try {
      return await run();
    } finally {
      const elapsedMs = Math.round(performance.now() - start);
      timings.push({ stage, elapsedMs });
      console.error(`destination stage=${stage} elapsedMs=${elapsedMs}`);
    }
  };
  try {
    requireDestinationShells(plan, (command, args, options) =>
      spawnSync(command, args, { ...options, env }),
    );
    const { runDestinationOracles } =
      await import('../test/shell-analysis/destinations/oracles.mjs');
    // Retain the real version probe; only the 5.1 I/O transport needs a bridge.
    if (platform === 'windows')
      plan.find(({ shell }) => shell === 'powershell-5.1').executable =
        windowsFixtureTool('fixture-powershell');
    oracle = await timed('oracles', () =>
      runDestinationOracles({
        onStage: (stage) =>
          console.error(
            `destination oracle-stage=${stage} atMs=${Math.round(performance.now())}`,
          ),
        shells: plan.map(({ shell }) => shell),
        executables: Object.fromEntries(
          plan.map(({ shell, executable }) => [shell, executable]),
        ),
      }),
    );
    if (
      oracle.failures.length ||
      oracle.shells.some((shell) => !shell.available || shell.failures.length)
    ) {
      throw new Error('destination shell oracle failed');
    }
    const parserTimings = [];
    for (const { shell, executable } of plan) {
      const file = path.join(temporary, `${shell}.json`);
      await timed(`cold-${shell}`, () =>
        runNode(
          [
            'test/shell-analysis/parsers/benchmark.mjs',
            '--shell',
            shell,
            '--executable',
            executable,
            '--output',
            file,
          ],
          env,
        ),
      );
      parserTimings.push({ shell, ...JSON.parse(readFileSync(file, 'utf8')) });
    }
    const differentialFile = path.join(temporary, 'differential.json');
    await timed('differential', () =>
      runNode(
        [
          'test/shell-analysis/destinations/differential.mjs',
          '--output',
          differentialFile,
          '--concurrency',
          '4',
        ],
        env,
      ),
    );
    const differential = JSON.parse(readFileSync(differentialFile, 'utf8'));
    differential.sourceCommit = sourceCommit;
    differential.observationProvenance = {
      regeneratedRows: differential.cases.length,
      reusedRows: 0,
    };
    differential.legs = plan.map(({ shell }) => {
      const parserEvidence = parserTimings.find((row) => row.shell === shell);
      const parserGatePassed = parserEvidence.verdict?.adapterPassed === true;
      const family =
        shell === 'powershell-5.1'
          ? 'powershell'
          : shell === 'git-bash' || shell === 'bash-3.2'
            ? 'bash'
            : shell;
      const cases = differential.cases.filter((row) => row.shell === family);
      const fallbackPassed =
        !parserGatePassed &&
        cases.length > 0 &&
        cases.every(
          (row) =>
            row.classification === 'correct' &&
            row.observedVia === 'real-pre-tool-use',
        );
      return {
        platform,
        node,
        shell,
        commitSha: sourceCommit,
        ciRunId,
        observationsRegenerated: true,
        corpusHash: differential.corpusHash,
        analyzerHash: differential.analyzerHash,
        runtimeHash: differential.runtimeHash,
        executable: plan.find((row) => row.shell === shell).executable,
        architecture: process.arch,
        status: 'passed',
        oraclePassed:
          applicableOraclePending(platform, oracle.pending ?? []).length === 0,
        parserGatePassed,
        parserEvidence,
        fallbackPassed,
        fallbackEvidence: {
          platform: process.platform,
          node: actualNode,
          shell,
          correctnessPassed: fallbackPassed,
          noticePassed: fallbackPassed,
          caseIds: cases.map((row) => row.id),
        },
      };
    });
    differential.parserTimings = parserTimings;
    differential.collectionTimings = timings;
    differential.oracles = [{ ...oracle, platform, node }];
    differential.oracleRequirementsChecked = true;
    differential.unresolvedOracles = applicableOraclePending(
      platform,
      oracle.pending ?? [],
    );
    mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    writeFileSync(output, `${JSON.stringify(differential, null, 2)}\n`);
    return differential;
  } catch (error) {
    writeFailedDestinationReport({
      output,
      platform,
      node,
      sourceCommit,
      ciRunId,
      plan,
      oracle,
      error,
    });
    throw error;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function main(args) {
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  const mode = value('--mode');
  if (mode === 'report') {
    if (!value('--output'))
      throw new Error('destination report output is required');
    await collectDestinationLeg({
      platform: value('--platform'),
      node: value('--node'),
      output: value('--output'),
    });
  } else if (mode === 'merge') {
    if (!value('--output'))
      throw new Error('destination merge output is required');
    const files = value('--inputs')?.split(',') ?? [];
    const coverage = value('--coverage') ?? 'full';
    if (!['full', 'ubuntu'].includes(coverage))
      throw new Error('destination coverage must be full or ubuntu');
    const requiredMatrix =
      coverage === 'full'
        ? FULL_DESTINATION_MATRIX
        : [{ platform: 'ubuntu', node: '26.1.0' }];
    const evidence = readDestinationEvidence(destinationRoot);
    const reports = files.map((file) => JSON.parse(readFileSync(file, 'utf8')));
    // The merger validates every raw observation before choosing a summary.
    // Resolve deferral inventory against all selected observations together: a
    // correct leg does not make another leg's accepted deferral stale.
    const merged = mergeDestinationReports(reports);
    const errors = validateDestinationSource(
      pluginRoot,
      {
        ...evidence,
        differential: merged,
      },
      { requiredMatrix },
    );
    if (errors.length)
      throw new Error(`destination CI gate failed: ${errors.join('; ')}`);
    writeFileSync(value('--output'), `${JSON.stringify(merged, null, 2)}\n`);
  } else if (mode === 'gate') {
    const errors = validateDestinationSource(
      pluginRoot,
      readDestinationEvidence(destinationRoot),
    );
    if (errors.length)
      throw new Error(`destination release gate failed: ${errors.join('; ')}`);
  } else
    throw new Error(
      'usage: destination-ci.mjs --mode report|merge|gate [--platform ubuntu|macos|windows --node 22|26.1.0 --output FILE]',
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
