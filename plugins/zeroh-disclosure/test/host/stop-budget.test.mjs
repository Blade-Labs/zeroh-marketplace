// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runHook, stateDirOf, tempProject } from '../helpers.mjs';

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

function stopProfile(project, sessionId, turn) {
  const output = path.join(project.home, `stop-profile-${turn}`);
  const preload = fileURLToPath(
    new URL('./stop-budget-profile.cjs', import.meta.url),
  );
  const stopped = runHook(
    'stop',
    { session_id: sessionId },
    {
      project,
      extraEnv: {
        ZEROH_STOP_PROFILE: output,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${JSON.stringify(pathToFileURL(preload).href)}`,
      },
    },
  );
  assert.equal(stopped.code, 0, 'Stop completes');
  assert.equal(
    stopped.stderr,
    '',
    'Stop does not fall back after a worker failure',
  );
  const threads = readdirSync(project.home)
    .filter((name) => name.startsWith(`${path.basename(output)}.`))
    .map((name) =>
      JSON.parse(readFileSync(path.join(project.home, name), 'utf8')),
    );
  assert.equal(
    threads.length,
    2,
    'both loader and Stop worker report completed work',
  );
  const main = threads.find((entry) => entry.isMainThread);
  assert.ok(main?.cpu, 'loader reports CPU time for the complete hook');
  const profile = {
    cpu: main.cpu.user + main.cpu.system,
    fileReads: 0,
    fileBytes: 0,
    ledgerReads: {},
    parses: 0,
    parsedBytes: 0,
    verifications: 0,
  };
  for (const thread of threads) {
    for (const key of [
      'fileReads',
      'fileBytes',
      'parses',
      'parsedBytes',
      'verifications',
    ]) {
      profile[key] += thread[key];
    }
    for (const [number, reads] of Object.entries(thread.ledgerReads)) {
      profile.ledgerReads[number] = (profile.ledgerReads[number] || 0) + reads;
    }
  }
  return profile;
}

function assertWorkBudget(profile, baseline, turn) {
  // Rendering the complete receipt needs one snapshot read per historical
  // ledger. Finalization, signing and commit bookkeeping may reopen only the
  // current ledger (three extra reads); repeated historical reads are a bug.
  assert.equal(
    Object.keys(profile.ledgerReads).length,
    turn,
    `turn ${turn}: every ledger is measured`,
  );
  for (const [number, reads] of Object.entries(profile.ledgerReads)) {
    assert.ok(
      reads <= (Number(number) === turn ? 4 : 1),
      `turn ${turn}: ledger ${number} is read ${reads} times`,
    );
  }
  assert.ok(
    profile.verifications > 0,
    'the profiler observes real signature verification',
  );
  assert.ok(
    profile.verifications <= 3,
    `turn ${turn}: at most three signature verifications, got ${profile.verifications}`,
  );

  // Subtract the necessary linear receipt work: fixed file-read overhead
  // stays flat, with two spare reads, and each extra ledger adds at most eight
  // parses, 28 KiB read and 36 KiB parsed (including decoded signed payloads).
  // These allowances are for this fixed synthetic prompt, not arbitrary user
  // content. No allowance depends on machine speed or scheduler load.
  const extraTurns = turn - 6;
  assert.ok(
    profile.fileReads <= baseline.fileReads + extraTurns + 2,
    `turn ${turn}: file-read overhead stays flat`,
  );
  assert.ok(
    profile.parses <= baseline.parses + extraTurns * 8 + 4,
    `turn ${turn}: JSON parses stay within the linear receipt budget`,
  );
  assert.ok(
    profile.fileBytes <= baseline.fileBytes + extraTurns * 28 * 1024 + 1024,
    `turn ${turn}: bytes read stay within the linear receipt budget`,
  );
  assert.ok(
    profile.parsedBytes <= baseline.parsedBytes + extraTurns * 36 * 1024 + 1024,
    `turn ${turn}: bytes parsed stay within the linear receipt budget`,
  );
}

test('Stop work stays bounded over 50 synthetic turns', (t) => {
  const project = tempProject({ env: false });
  const sessionId = 'stop-budget';
  const profiles = [];
  for (let turn = 1; turn <= 50; turn++) {
    const prompt = runHook(
      'user-prompt-submit',
      {
        session_id: sessionId,
        prompt: 'Please summarize the README.',
      },
      { project },
    );
    assert.equal(prompt.code, 0, 'synthetic prompt completes');
    const profile = stopProfile(project, sessionId, turn);
    profiles.push(profile);
    if ([6, 50].includes(turn)) {
      const { ledgerReads, cpu, ...work } = profile;
      t.diagnostic(
        `Stop work at turn ${turn}: ${JSON.stringify({ ...work, ledgerReadOverhead: Object.values(ledgerReads).reduce((sum, reads) => sum + reads, 0) - turn, fileReadOverhead: profile.fileReads - turn })}`,
      );
    }
    if (turn >= 6) assertWorkBudget(profile, profiles[5], turn);
  }
  // CPU time excludes time spent descheduled. This generous safety net is
  // secondary to the deterministic operation budgets below.
  const early =
    median(profiles.slice(5, 15).map((profile) => profile.cpu)) / 1000;
  const late =
    median(profiles.slice(40, 50).map((profile) => profile.cpu)) / 1000;
  t.diagnostic(
    `Stop CPU: early=${early.toFixed(1)} ms; late=${late.toFixed(1)} ms; bound=${(early * 4 + 250).toFixed(1)} ms`,
  );
  assert.ok(
    late <= early * 4 + 250,
    'Stop CPU time remains within the coarse safety budget',
  );
  const dir = path.join(stateDirOf(project), 'sessions', sessionId);
  const bundle = JSON.parse(
    readFileSync(path.join(dir, 'session.bundle.json'), 'utf8'),
  );
  assert.equal(bundle.summary.receipts_count, 50);
  assert.equal(bundle.receipts.at(-1).turn, 50);
  assert.equal(
    bundle.receipts.every((record) => record.turn_summary?.compact),
    true,
  );
  assert.match(
    readFileSync(path.join(dir, 'receipt.html'), 'utf8'),
    /turn 50|Turn 50/u,
  );
});
