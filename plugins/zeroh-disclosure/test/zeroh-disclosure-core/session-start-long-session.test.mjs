// SPDX-License-Identifier: AGPL-3.0-only

// Phase 789.2: a resumed or compacted long session. SessionStart listed every
// token the session ever saw, about 28 characters each: 84,838 characters of
// briefing at 1,000 turns. Claude Code keeps hook context inline only up to a
// limit (11,827 characters was already saved to a file), so past it the whole
// ZeroH briefing left the model's context.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runHook, stateDirOf, tempProject } from '../helpers.mjs';

const TURNS = 500;
const labelOf = (turn) => `[API_KEY-${turn.toString(16).padStart(6, '0')}]`;
const at = (minute) =>
  new Date(Date.UTC(2026, 10, 1) + minute * 60_000).toISOString();
const OLD_TOOL = '[EMAIL-0dd001]';
const NEW_TOOL = '[EMAIL-0dd002]';

function longSession(project, sessionId) {
  const dir = path.join(stateDirOf(project), 'sessions', sessionId);
  mkdirSync(dir, { recursive: true });
  for (let turn = 1; turn <= TURNS; turn += 1) {
    writeFileSync(
      path.join(dir, `turn-${turn}.json`),
      JSON.stringify({
        turn,
        created_at: at(turn),
        replacements: [{ replacement: labelOf(turn), entity_type: 'API_KEY' }],
      }),
    );
  }
  // Tool records are written as the turn runs; their ids carry no time.
  const tool = (name, minute, replacement) =>
    writeFileSync(
      path.join(dir, `tool-${name}.json`),
      JSON.stringify({
        created_at: at(minute),
        fields: [{ replacements: [{ replacement, entity_type: 'EMAIL' }] }],
      }),
    );
  tool('toolu_zzz_old', 0, OLD_TOOL);
  tool('toolu_aaa_new', TURNS + 1, NEW_TOOL);
}

test('a resumed long session keeps the briefing short: the 40 newest carried tokens, tool or turn, and a count of the rest', () => {
  const project = tempProject({ env: false });
  longSession(project, 'long');
  const res = runHook(
    'session-start',
    { session_id: 'long', source: 'resume' },
    { project },
  );
  assert.equal(res.code, 0, res.stderr);
  const context = res.json.hookSpecificOutput.additionalContext;
  assert.ok(
    context.length < 10_000,
    `briefing is ${context.length} characters`,
  );
  const listed = context.match(/^ {2}\[[A-Z_]+-[0-9a-f]{6}\] = [a-z_]+$/gmu);
  assert.equal(listed?.length, 40);
  assert.ok(context.includes(`${NEW_TOOL} = email`), 'the newest, from a tool');
  for (let turn = TURNS - 38; turn <= TURNS; turn += 1)
    assert.ok(context.includes(`${labelOf(turn)} = api_key`), `turn ${turn}`);
  assert.ok(!context.includes(labelOf(TURNS - 39)), 'turn 461 is the 41st');
  assert.ok(!context.includes(OLD_TOOL), 'an old tool token is not listed');
  assert.match(context, /462 more/u);
});
