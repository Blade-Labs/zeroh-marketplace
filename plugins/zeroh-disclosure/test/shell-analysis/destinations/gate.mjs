// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateCorpus } from './corpus.mjs';
import { gateVerdict, percentiles } from '../parsers/benchmark.mjs';

export const REQUIRED_LEGS = Object.freeze({
  ubuntu: ['bash', 'zsh'],
  macos: ['bash-3.2', 'bash', 'zsh', 'pwsh'],
  windows: ['git-bash', 'pwsh', 'powershell-5.1', 'cmd'],
});
export const REQUIRED_NODES = Object.freeze(['22', '26.1.0']);
export const FULL_DESTINATION_MATRIX = Object.freeze(
  Object.keys(REQUIRED_LEGS).flatMap((platform) =>
    REQUIRED_NODES.map((node) => ({ platform, node })),
  ),
);

// SSH authentication shares the Linux account/server fixture with program
// effects. Other platforms still require all their shell, parser and wire oracles.
export function applicableOraclePending(platform, pending) {
  return pending.filter(
    (reason) =>
      !['macos', 'windows'].includes(platform) ||
      !/^(?:programs|resolved|sshAuthenticated):/u.test(reason),
  );
}

export function validateOracleCoverage(
  differential,
  requiredMatrix = FULL_DESTINATION_MATRIX,
) {
  const errors = [];
  for (const { platform, node } of requiredMatrix) {
    const shells = REQUIRED_LEGS[platform];
    const reports = (differential?.oracles ?? []).filter(
      (report) => report.platform === platform && report.node === node,
    );
    const report = reports[0];
    const label = `${platform}/${node}`;
    if (
      reports.length !== 1 ||
      report.oracleRequirementsChecked !== true ||
      !Array.isArray(report.failures) ||
      report.failures.length ||
      !Array.isArray(report.pending) ||
      !Array.isArray(report.shells) ||
      shells.some((shell) => {
        const matches = report.shells.filter((entry) => entry.shell === shell);
        return (
          matches.length !== 1 ||
          !matches[0].available ||
          !Array.isArray(matches[0].failures) ||
          matches[0].failures.length
        );
      })
    ) {
      errors.push(`destination oracle coverage is incomplete: ${label}`);
      continue;
    }
    for (const pending of applicableOraclePending(platform, report.pending))
      errors.push(`destination oracle pending: ${label}: ${pending}`);
    if (platform === 'ubuntu') {
      for (const name of ['resolved', 'sshAuthenticated'])
        if (report.requests?.[name]?.status !== 'passed')
          errors.push(
            `required destination oracle ${label}/${name} did not run`,
          );
      const programs = report.requests?.programs;
      if (
        !Array.isArray(programs?.failures) ||
        programs.failures.length ||
        !Array.isArray(programs?.results) ||
        [
          'wget',
          'git',
          'gh',
          'az',
          'docker',
          'kubectl',
          'helm',
          'aws',
          'gcloud',
          'nc',
          'openssl',
          'redis-cli',
          'psql',
          'mysql',
          'ssh',
          'scp',
        ].some(
          (program) =>
            !programs.results.some(
              (entry) => entry.program === program && entry.status === 'passed',
            ),
        )
      )
        errors.push(
          `required destination oracle ${label}/programs did not run`,
        );
    }
  }
  return errors;
}

export const RELEASES_WITH_1_0_ANALYZER = new Set(['1.1.0', '1.1.1', '1.1.2']);

export const OWNER_RULING = 'owner ruling 2026-10-05, ruling 1';
export const BASELINE_HASH =
  '17a40e1c5ec6ba95b600d434d33f58c75fe500b411660bc6a325131c04a25503';
export const HISTORY_HASH =
  '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
export const evidenceHash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const datedUpdate = (entry) =>
  entry?.explicit === true &&
  /^\d{4}-\d{2}-\d{2}$/u.test(entry.date ?? '') &&
  filled(entry.reason);

export function releaseSourceCommit(pluginSource) {
  const result = spawnSync('git', ['-C', pluginSource, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  });
  if (result.status !== 0 || !/^[a-f0-9]{40}$/u.test(result.stdout.trim()))
    throw new Error('release source commit is unavailable');
  return result.stdout.trim();
}

function authorizedHash(
  value,
  anchor,
  updates,
  ownerRuled = false,
  fileHash = null,
) {
  if (value === undefined || !Array.isArray(updates)) return false;
  let current = anchor;
  for (const update of updates ?? []) {
    if (
      !datedUpdate(update) ||
      update.beforeHash !== current ||
      !/^[a-f0-9]{64}$/u.test(update.afterHash ?? '') ||
      (ownerRuled &&
        !/^owner ruling \d{4}-\d{2}-\d{2}/u.test(update.rulingReference ?? ''))
    )
      return false;
    current = update.afterHash;
  }
  return current === (fileHash ?? evidenceHash(value));
}

const filled = (value) => typeof value === 'string' && value.trim().length > 0;
const fingerprint = (entry) =>
  JSON.stringify([
    entry.program,
    entry.spelling,
    entry.shell,
    entry.classification,
    entry.reason,
    entry.notice,
    entry.releaseNote,
    entry.nextReleaseTask,
    entry.rulingReference,
    entry.noticePhase,
    entry.nextRelease,
  ]);

export function corpusCaseIds() {
  return generateCorpus().map((entry) => entry.id);
}

export function destinationFingerprints(pluginSource) {
  const hash = createHash('sha256');
  const runtime = createHash('sha256');
  let hashingRuntime = true;
  const addFile = (name) => {
    const content = readFileSync(path.join(pluginSource, name));
    hash.update(name).update('\0').update(content).update('\0');
    if (hashingRuntime)
      runtime.update(name).update('\0').update(content).update('\0');
  };
  function visit(relative) {
    for (const entry of readdirSync(path.join(pluginSource, relative), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(name);
      else {
        addFile(name);
      }
    }
  }
  // Hash the full runtime superset: every hook and its transitive local imports.
  visit('packages');
  visit('lib');
  visit('vendor');
  visit('hooks');
  hashingRuntime = false;
  visit('test/shell-analysis/parsers');
  visit('test/shell-analysis/destinations/vendor');
  for (const relative of [
    'test/shell-analysis/destinations/wildcard-dns.mjs',
    'test/shell-analysis/destinations/wildcard-fixtures.json',
    'test/shell-analysis/destinations/program-effects.mjs',
    'test/shell-analysis/destinations/historical-effects.mjs',
    'test/shell-analysis/destinations/ci-effects.mjs',
    'test/shell-analysis/destinations/resolved-namespace.sh',
    'test/shell-analysis/destinations/loopback-guard.c',
    'test/shell-analysis/destinations/corpus.mjs',
    'test/shell-analysis/destinations/historical-seeds.json',
    'test/shell-analysis/destinations/oracles.mjs',
    'test/shell-analysis/destinations/parser-oracles.mjs',
    'test/shell-analysis/destinations/isolation.mjs',
    'test/shell-analysis/destinations/native-argv.cs',
    'test/shell-analysis/destinations/differential.mjs',
    'test/shell-analysis/destinations/gate.mjs',
    'test/shell-analysis/destinations/seeds/spike-42.txt',
    'scripts/destination-ci.mjs',
  ]) {
    addFile(relative);
  }
  return {
    corpusHash: createHash('sha256')
      .update(JSON.stringify(generateCorpus()))
      .digest('hex'),
    analyzerHash: hash.digest('hex'),
    runtimeHash: runtime.digest('hex'),
  };
}

export function validateDestinationSource(
  pluginSource,
  evidence,
  { requiredMatrix = FULL_DESTINATION_MATRIX } = {},
) {
  const sourceCommit = releaseSourceCommit(pluginSource);
  const releaseVersion = JSON.parse(
    readFileSync(path.join(pluginSource, 'package.json'), 'utf8'),
  ).version;
  const errors = validateDestinationRelease(
    {
      ...evidence,
      sourceCommit,
      releaseVersion,
    },
    { requiredMatrix },
  );
  const ciCommit = evidence.differential?.sourceCommit;
  // Evidence may be committed after CI. Git ancestry plus exact fingerprints
  // binds that older observation to the source being released.
  if (
    !/^[a-f0-9]{40}$/u.test(ciCommit ?? '') ||
    spawnSync(
      'git',
      [
        '-C',
        pluginSource,
        'merge-base',
        '--is-ancestor',
        ciCommit,
        sourceCommit,
      ],
      { stdio: 'ignore' },
    ).status !== 0
  )
    errors.push(
      'destination CI commit is not an ancestor of the release source',
    );
  if (
    evidence.differential?.observationProvenance?.reusedRows !== 0 ||
    evidence.differential?.observationProvenance?.regeneratedRows !==
      evidence.differential?.cases?.length
  )
    errors.push(
      'destination evidence must regenerate every observation before a CI pass',
    );
  if (
    !authorizedHash(
      evidence.baseline,
      BASELINE_HASH,
      evidence.baselineUpdates,
      true,
      createHash('sha256')
        .update(
          readFileSync(
            path.join(
              pluginSource,
              'test/shell-analysis/destinations/baseline-1.0.json',
            ),
          ),
        )
        .digest('hex'),
    )
  )
    errors.push(
      '1.0 baseline changed without an explicit dated owner-ruled update',
    );
  if (
    HISTORY_HASH !== evidenceHash([]) ||
    !authorizedHash(
      evidence.previousDeferrals,
      HISTORY_HASH,
      evidence.historyUpdates,
    )
  )
    errors.push(
      'deferral history changed without an explicit dated history update',
    );
  errors.push(...validateOracleCoverage(evidence.differential, requiredMatrix));
  if (
    evidence.differential?.oracleRequirementsChecked !== true ||
    !Array.isArray(evidence.differential?.unresolvedOracles)
  )
    errors.push('destination oracle coverage is incomplete');
  for (const pending of evidence.differential?.unresolvedOracles ?? [])
    errors.push(`destination oracle pending: ${pending}`);
  const current = destinationFingerprints(pluginSource);
  for (const key of ['corpusHash', 'analyzerHash', 'runtimeHash']) {
    if (evidence.differential?.[key] !== current[key])
      errors.push(`stale destination ${key}`);
  }
  const expected = new Set(corpusCaseIds());
  const canonical = new Map(generateCorpus().map((entry) => [entry.id, entry]));
  const observed = new Set(
    evidence.differential?.cases?.map((entry) => entry.id) ?? [],
  );
  if (
    expected.size !== observed.size ||
    [...expected].some((id) => !observed.has(id))
  )
    errors.push('destination evidence does not cover the current corpus');
  for (const entry of evidence.differential?.cases ?? []) {
    const row = canonical.get(entry.id);
    if (
      row &&
      ['program', 'spelling', 'shell'].some((key) => row[key] !== entry[key])
    )
      errors.push(
        `destination case ${entry.id} metadata differs from the corpus`,
      );
  }
  if (Array.isArray(evidence.deferrals) && evidence.deferrals.length) {
    const changelog = readFileSync(
      path.join(pluginSource, 'CHANGELOG.md'),
      'utf8',
    );
    let nextTasks = [];
    try {
      nextTasks = JSON.parse(
        readFileSync(
          path.join(
            pluginSource,
            'test/shell-analysis/destinations/next-release-tasks.json',
          ),
          'utf8',
        ),
      );
      if (!Array.isArray(nextTasks)) nextTasks = [];
    } catch {
      /* Missing inventory cannot authorize a deferral. */
    }
    for (const entry of evidence.deferrals) {
      if (!filled(entry.releaseNote) || !changelog.includes(entry.releaseNote))
        errors.push(`deferral ${entry.id} has no actual release-note entry`);
      if (
        !nextTasks.some(
          (task) =>
            task.id === entry.nextReleaseTask &&
            filled(task.reason) &&
            task.caseIds?.includes(entry.id),
        )
      )
        errors.push(`deferral ${entry.id} has no next-release task`);
    }
  }
  for (const leg of evidence.differential?.legs ?? []) {
    if (
      RELEASES_WITH_1_0_ANALYZER.has(releaseVersion) ||
      leg.shell === 'cmd' ||
      leg.parserGatePassed === true ||
      leg.fallbackPassed !== true
    )
      continue;
    const note = leg.fallbackEvidence?.releaseNote;
    if (
      !filled(note) ||
      !readFileSync(path.join(pluginSource, 'CHANGELOG.md'), 'utf8').includes(
        note,
      )
    )
      errors.push(
        `slow parser fallback ${leg.platform}/${leg.node}/${leg.shell} has no release-note entry`,
      );
  }
  return errors;
}

function baselineMatcher(baseline, releaseVersion) {
  const rows = new Map((baseline?.entries ?? []).map((row) => [row.id, row]));
  const commands = new Map(
    generateCorpus().map((row) => [row.id, row.command]),
  );
  return (row) => {
    const accepted = rows.get(row.id);
    const command = commands.get(row.id);
    return (
      RELEASES_WITH_1_0_ANALYZER.has(releaseVersion) &&
      baseline?.rulingReference === OWNER_RULING &&
      typeof command === 'string' &&
      accepted?.commandHash ===
        createHash('sha256').update(command).digest('hex') &&
      ['id', 'program', 'spelling', 'shell', 'classification'].every(
        (key) => accepted?.[key] === row[key],
      )
    );
  };
}

// Retain every observation: the aggregate is a display summary, never an allowance.
function caseObservations(entry) {
  return [
    entry,
    ...(entry.observationsByLeg ?? []).flatMap((row) =>
      caseObservations({
        id: entry.id,
        program: entry.program,
        spelling: entry.spelling,
        shell: entry.shell,
        ...row,
      }),
    ),
  ];
}

export function validateDestinationObservations({
  differential,
  baseline,
  deferrals,
  releaseVersion = '1.1.0',
}) {
  const errors = [];
  const inBaseline = baselineMatcher(baseline, releaseVersion);
  const deferred = new Map((deferrals ?? []).map((row) => [row.id, row]));
  const observations = (differential?.cases ?? []).flatMap(caseObservations);
  for (const entry of observations) {
    if (entry.observationStatus === 'timeout') {
      errors.push(`destination hook timeout after serial retry: ${entry.id}`);
      continue;
    }
    if (
      ![
        'correct',
        'false-stop',
        'missed-protection',
        'notice-gap',
        'receipt-gap',
        'parser-disagreement',
      ].includes(entry.classification)
    )
      errors.push(
        `untriaged destination case ${entry.id}: ${entry.classification ?? 'unknown'}`,
      );
    else if (entry.classification === 'false-stop' && !inBaseline(entry))
      errors.push(`false stop outside the accepted baseline: ${entry.id}`);
    else if (
      RELEASES_WITH_1_0_ANALYZER.has(releaseVersion) &&
      entry.classification !== 'correct' &&
      !inBaseline(entry)
    )
      errors.push(
        `new non-correct destination case outside the 1.0 baseline: ${entry.id}`,
      );
    else if (entry.classification !== 'correct' && !deferred.has(entry.id))
      errors.push(
        `untriaged destination case ${entry.id}: ${entry.classification ?? 'unknown'}`,
      );
    if (entry.classification !== 'correct' && deferred.has(entry.id)) {
      const deferral = deferred.get(entry.id);
      if (
        ['id', 'program', 'spelling', 'shell', 'classification'].some(
          (key) => deferral[key] !== entry[key],
        )
      )
        errors.push(
          `deferral ${entry.id} classification or metadata differs from evidence`,
        );
      if (
        !inBaseline(entry) &&
        (!filled(entry.notice) || deferral.notice !== entry.notice)
      )
        errors.push(`deferral ${entry.id} notice was not observed`);
    }
  }
  return [...new Set(errors)];
}

// Evidence describes observations, while triage describes the owner's disposition.
// A blocking-list entry is never an exemption from the release gate.
export function validateDestinationRelease(
  {
    differential,
    blocking,
    deferrals,
    previousDeferrals,
    updates,
    baseline,
    releaseVersion = '1.1.0',
  },
  { requiredMatrix = FULL_DESTINATION_MATRIX } = {},
) {
  const errors = [];
  if (
    differential?.schemaVersion !== 1 ||
    !Array.isArray(differential?.cases)
  ) {
    return ['destination evidence is missing or malformed'];
  }
  if (!/^[a-f0-9]{64}$/u.test(differential.corpusHash ?? ''))
    errors.push('destination corpus hash is missing');
  if (!/^[a-f0-9]{64}$/u.test(differential.analyzerHash ?? ''))
    errors.push('destination analyzer hash is missing');
  if (!/^[a-f0-9]{64}$/u.test(differential.runtimeHash ?? ''))
    errors.push('destination runtime hash is missing');
  if (!/^[a-f0-9]{40}$/u.test(differential.sourceCommit ?? ''))
    errors.push('destination CI source commit is missing');
  if (
    !Array.isArray(blocking) ||
    !Array.isArray(deferrals) ||
    !Array.isArray(previousDeferrals) ||
    !Array.isArray(updates)
  ) {
    return [...errors, 'destination triage lists are malformed'];
  }
  const cases = new Map();
  for (const entry of differential.cases) {
    if (!filled(entry.id) || cases.has(entry.id))
      errors.push(
        'destination evidence contains a missing or duplicate case id',
      );
    cases.set(entry.id, entry);
  }
  if (!cases.size) errors.push('destination evidence contains no cases');
  const acceptedBaseline = new Map(
    (baseline?.entries ?? []).map((row) => [row.id, row]),
  );
  const canonicalCommands = new Map(
    generateCorpus().map((row) => [row.id, row.command]),
  );
  const matchesCommand = (row) => {
    const command = canonicalCommands.get(row.id);
    return (
      typeof command === 'string' &&
      row.commandHash === createHash('sha256').update(command).digest('hex')
    );
  };
  for (const row of acceptedBaseline.values())
    if (!matchesCommand(row))
      errors.push(
        `baseline command hash differs from the current corpus: ${row.id}`,
      );
  const inBaseline = baselineMatcher(baseline, releaseVersion);
  const completeCoverage = FULL_DESTINATION_MATRIX.every(({ platform, node }) =>
    requiredMatrix.some(
      (leg) => leg.platform === platform && leg.node === node,
    ),
  );
  const deferred = new Map();
  for (const entry of deferrals) {
    if (!filled(entry.id) || deferred.has(entry.id))
      errors.push(
        'destination deferrals contain a missing or duplicate case id',
      );
    deferred.set(entry.id, entry);
    for (const key of [
      'program',
      'spelling',
      'shell',
      'classification',
      'reason',
      'notice',
      'releaseNote',
      'nextReleaseTask',
    ]) {
      if (!filled(entry[key]))
        errors.push(`deferral ${entry.id ?? 'unknown'} lacks ${key}`);
    }
    const observedRows = cases.has(entry.id)
      ? caseObservations(cases.get(entry.id)).filter(
          (row) => row.classification !== 'correct',
        )
      : [];
    if (inBaseline(entry)) {
      if (
        entry.rulingReference !== OWNER_RULING ||
        entry.noticePhase !== '55.4' ||
        entry.nextReleaseTask !== '44.9' ||
        entry.nextRelease !== '1.1.3'
      )
        errors.push(
          `baseline deferral ${entry.id} lacks the owner ruling, 55.4 notice or 1.1.3 task 44.9`,
        );
    } else if (entry.classification !== 'missed-protection') {
      errors.push(
        `destination kind ${entry.classification} is not deferrable: ${entry.id}`,
      );
    }
    // Only the full matrix can establish that a cross-platform deferral is
    // obsolete. Partial CI still validates its metadata and all supplied rows.
    if (!observedRows.length && completeCoverage)
      errors.push(`deferral ${entry.id} has no unresolved observed case`);
    for (const observed of observedRows) {
      if (entry.classification !== observed.classification)
        errors.push(
          `deferral ${entry.id} classification differs from evidence`,
        );
      if (
        !inBaseline(entry) &&
        (!filled(observed.notice) || entry.notice !== observed.notice)
      )
        errors.push(`deferral ${entry.id} notice was not observed`);
    }
  }
  errors.push(
    ...validateDestinationObservations({
      differential,
      baseline,
      deferrals,
      releaseVersion,
    }),
  );
  for (const entry of blocking) {
    if (
      !filled(entry.id) ||
      !cases.has(entry.id) ||
      cases.get(entry.id).classification === 'correct' ||
      cases.get(entry.id).classification !== entry.classification
    )
      errors.push(
        `stale or malformed destination blocker ${entry.id ?? 'unknown'}`,
      );
    else errors.push(`blocking destination case ${entry.id}`);
  }
  for (const old of previousDeferrals) {
    const current = deferred.get(old.id);
    const changed = !current || fingerprint(old) !== fingerprint(current);
    if (!changed) continue;
    if (!current && cases.get(old.id)?.classification === 'correct') continue;
    const update = updates.find(
      (entry) =>
        entry.id === old.id &&
        datedUpdate(entry) &&
        entry.beforeHash === evidenceHash(old) &&
        entry.afterHash === evidenceHash(current ?? null),
    );
    if (!update)
      errors.push(
        `deferral ${old.id} removed or changed without a fix or explicit update`,
      );
    if (!current && cases.get(old.id)?.classification !== 'correct')
      errors.push(`deferral ${old.id} remains unresolved after removal`);
  }
  const legs = differential.legs;
  if (!Array.isArray(legs))
    errors.push('destination shell evidence is missing');
  for (const { platform, node } of requiredMatrix) {
    const shells = REQUIRED_LEGS[platform];
    for (const shell of shells) {
      const matches = (legs ?? []).filter(
        (entry) =>
          entry.platform === platform &&
          String(entry.node) === node &&
          entry.shell === shell,
      );
      const leg = matches[0];
      if (
        matches.length !== 1 ||
        leg.status !== 'passed' ||
        leg.oraclePassed !== true ||
        !/^[a-f0-9]{40}$/u.test(leg.commitSha ?? '') ||
        leg.commitSha !== differential.sourceCommit ||
        typeof leg.ciRunId !== 'string' ||
        !/^[0-9]+$/u.test(leg.ciRunId) ||
        leg.observationsRegenerated !== true ||
        leg.corpusHash !== differential.corpusHash ||
        leg.analyzerHash !== differential.analyzerHash ||
        leg.runtimeHash !== differential.runtimeHash ||
        (!RELEASES_WITH_1_0_ANALYZER.has(releaseVersion) &&
          !validParserProof(leg, cases))
      ) {
        errors.push(
          `required destination leg ${platform}/${node}/${shell} lacks passing evidence`,
        );
      }
    }
  }
  return [...new Set(errors)];
}

function validParserProof(leg, cases) {
  if (leg.parserGatePassed === true && leg.shell !== 'cmd') {
    const proof = leg.parserEvidence;
    try {
      const platform = { linux: 'ubuntu', darwin: 'macos', win32: 'windows' }[
        proof?.platform
      ];
      if (
        platform !== leg.platform ||
        proof?.shell !== leg.shell ||
        !(leg.node === '22'
          ? /^22\./u.test(proof?.node ?? '')
          : proof?.node === leg.node)
      )
        return false;
      if (
        proof?.sampleCount !== 20 ||
        proof.corpusCount !== 60 ||
        proof.corpusSha256 !==
          'ad0f8ceaa5d31a86e093308bd5256a6d44a746309c4483fc58468c4fcaa2bb28'
      )
        return false;
      const parser = percentiles(proof.rawSamples.parser);
      const hook = percentiles(proof.rawSamples.wholeHook);
      const baselineHook = percentiles(proof.rawSamples.noAdapterHook);
      if (
        [
          ...proof.rawSamples.parser,
          ...proof.rawSamples.wholeHook,
          ...proof.rawSamples.noAdapterHook,
        ].some((sample) => sample >= 8000)
      )
        return false;
      const family = ['pwsh', 'powershell-5.1'].includes(leg.shell)
        ? 'powershell'
        : 'bash';
      if (!gateVerdict(parser, hook, family, null, baselineHook).adapterPassed)
        return false;
      return ['parser', 'wholeHook', 'noAdapterHook'].every(
        (measure) =>
          proof.measures[measure].count === 20 &&
          proof.measures[measure].p95Ms ===
            { parser, wholeHook: hook, noAdapterHook: baselineHook }[measure]
              .p95Ms &&
          proof.measures[measure].p50Ms ===
            { parser, wholeHook: hook, noAdapterHook: baselineHook }[measure]
              .p50Ms,
      );
    } catch {
      return false;
    }
  }
  // cmd and an over-budget adapter retain 1.0 only with full correctness/notice proof.
  const proof = leg.fallbackEvidence;
  if (
    { linux: 'ubuntu', darwin: 'macos', win32: 'windows' }[proof?.platform] !==
      leg.platform ||
    proof?.shell !== leg.shell ||
    !(leg.node === '22'
      ? /^22\./u.test(proof?.node ?? '')
      : proof?.node === leg.node)
  )
    return false;
  const family =
    leg.shell === 'powershell-5.1'
      ? 'powershell'
      : leg.shell === 'git-bash' || leg.shell === 'bash-3.2'
        ? 'bash'
        : leg.shell;
  const relevant = [...cases.values()].filter(
    (entry) => entry.shell === family,
  );
  return (
    leg.fallbackPassed === true &&
    proof?.correctnessPassed === true &&
    proof?.noticePassed === true &&
    relevant.length > 0 &&
    relevant.every((entry) => {
      const observed = entry.observationsByLeg
        ? entry.observationsByLeg.find((row) =>
            row.legs?.includes(`${leg.platform}/${leg.node}`),
          )
        : entry;
      return (
        observed?.classification === 'correct' &&
        observed.observedVia === 'real-pre-tool-use' &&
        proof.caseIds?.includes(entry.id)
      );
    })
  );
}

export function readDestinationEvidence(root) {
  const read = (file) =>
    JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  const history = read('deferral-history.json');
  return {
    differential: read('evidence/differential.json'),
    baseline: read('baseline-1.0.json'),
    baselineUpdates: read('baseline-updates.json'),
    historyUpdates: history.historyUpdates,
    blocking: read('blocking.json'),
    deferrals: read('deferrals.json'),
    previousDeferrals: history.previousDeferrals,
    updates: history.updates,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const index = process.argv.indexOf('--evidence');
    if (index < 0 || !process.argv[index + 1])
      throw new Error('usage: gate.mjs --evidence <destination-directory>');
    const evidenceRoot = path.resolve(process.argv[index + 1]);
    const sourceIndex = process.argv.indexOf('--source');
    const source =
      sourceIndex < 0
        ? path.resolve(evidenceRoot, '../../..')
        : process.argv[sourceIndex + 1];
    const errors = validateDestinationSource(
      source,
      readDestinationEvidence(evidenceRoot),
    );
    // Case ids and classifications only: no commands or restored values in diagnostics.
    for (const error of errors) console.error(error);
    process.exitCode = errors.length ? 1 : 0;
  } catch {
    console.error('destination release evidence could not be validated');
    process.exitCode = 1;
  }
}
