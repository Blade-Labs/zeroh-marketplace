// SPDX-License-Identifier: AGPL-3.0-only

// The deny inventory (product principles gate, docs/product-principles.md).
// Every place a hook denies a tool call or stops a prompt carries a
// `// deny-inventory: <code>` comment, and every code is listed here with its
// kind. A new denial fails this test until it is added deliberately, with a
// justification that fits the principles:
//   destination  a secret heading to a host (or MCP server) not allowed for it
//   protection   the model changing ZeroH's own protection
//   block-mode   applies only with `uncertain block` (opt-in)
//   kept         a stop the owner decided to keep, with the reason
//   open         still stops by default; listed for an owner decision
// `open` entries had to shrink to zero before 1.0; they did in rc.2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PLUGIN } from './helpers.mjs';

const INVENTORY = {
  // --- destination: a secret heading somewhere not allowed for it.
  'host-not-allowed': [
    'destination',
    'a restored or raw secret to a host the allow rules do not permit',
  ],
  'mcp-not-allowed': [
    'destination',
    'a secret to an MCP server with no allow rule for it',
  ],
  // --- protection: the model changing ZeroH's own protection.
  'user-only-command': ['protection', 'a user-only slash command via a tool'],
  'elicitation-hook': [
    'protection',
    'an Elicitation hook would answer unmask consent',
  ],
  'management-cli': [
    'protection',
    'UX layer for the CLI refusal (lib/user-authority.js)',
  ],
  'protected-path-write': [
    'protection',
    'writes, deletes or executes against Claude settings, plugin files or hooks; reads only in block mode',
  ],
  'zeroh-settings': ['protection', "ZeroH's settings, keys, vault and proxy"],
  'unmask-session-claim': [
    'protection',
    'two sessions racing one unmask request',
  ],
  'sensitive-file': [
    'protection',
    "ZeroH's own keys in every mode; other credential files only in block mode",
  ],
  'management-request': [
    'protection',
    "ZeroH's own management command with no matching request; ordinary prompts never",
  ],
  // --- block-mode: opt-in only.
  'background-no-proxy': ['block-mode', 'D-22'],
  'uncertain-destination': [
    'block-mode',
    'dynamic, script, launcher, unparseable',
  ],
  'variable-in-command': [
    'block-mode',
    'a command sends only a variable reference (`-u "$KEY:"`): what it holds is unseen',
  ],
  'prompt-too-large': ['block-mode', 'owner decision 2026-09-27'],
  'vault-unavailable-prompt': ['block-mode', 'owner decision 2026-09-27'],
  'vault-unsaveable-prompt': ['block-mode', 'owner decision 2026-09-27'],
  'typed-secret-no-proxy': ['block-mode', 'A1, owner decision 2026-09-27'],
  'session-transcript': [
    'block-mode',
    "a command using Claude Code's session files, which keep typed values as-is (1.0.1)",
  ],
  'watchdog-block': [
    'block-mode',
    'the loader passes with a notice by default',
  ],
  // --- kept: the owner kept these stops.
  'dead-proxy': [
    'kept',
    'D-10: the session points at a ZeroH proxy that does not answer; sending would fail',
  ],
  // The last eight default stops (owner decision 2026-09-27): each passes
  // with a notice by default (test/rc2-last-stops.test.mjs).
  'raw-secret-policy': [
    'block-mode',
    'shells, MCP and WebFetch URLs follow the destination rules by default (D-23)',
  ],
  'config-unreadable': [
    'block-mode',
    'an unreadable .zeroh.env: defaults with a notice by default',
  ],
  'vault-unavailable-tool': [
    'block-mode',
    'runs with the token, with a notice, by default',
  ],
  // Rule 8: a vault that opens but can't be saved (test/vault-unsaveable).
  'vault-unsaveable-output': [
    'block-mode',
    'new values pass unmasked, with a notice, by default',
  ],
  'vault-unsaveable-tool': [
    'block-mode',
    'the input keeps the values as written, with a notice, by default',
  ],
  'expired-token': [
    'block-mode',
    'runs with the token text, with a notice, by default',
  ],
  'monitor-restore': [
    'block-mode',
    'Monitor runs with the token, with a notice, by default',
  ],
  'output-too-large': [
    'block-mode',
    'passed unscanned, with a notice, by default',
  ],
  'output-check-failed': [
    'block-mode',
    'passed as it is, with a notice, by default',
  ],
  'late-binding-failed': [
    'block-mode',
    'runs with the token, with a notice, by default',
  ],
};
const KINDS = new Set([
  'destination',
  'protection',
  'block-mode',
  'kept',
  'open',
]);

const DENY_SITE =
  /\bemitDeny\(|\bstopPrompt\(|\bemitWithheld\(|withheldOutput\(|permissionDecision:\s*'deny'|decision:\s*'block'/u;
// The helpers that build a denial are not denials themselves.
const DEFINITIONS = [
  /function emitDeny\(/u,
  /export function stopPrompt\(/u,
  /function emitWithheld\(/u,
  /export function withheldOutput\(/u,
];

function sources() {
  const out = [];
  for (const dir of ['hooks', 'lib', 'mcp', 'bin']) {
    let entries = [];
    try {
      entries = readdirSync(path.join(PLUGIN, dir), { recursive: true });
    } catch {
      continue;
    }
    for (const name of entries)
      if (/\.(?:m?js)$/u.test(name)) out.push(path.join(dir, name));
  }
  return out;
}

function sites() {
  const found = [];
  for (const file of sources()) {
    const lines = readFileSync(path.join(PLUGIN, file), 'utf8').split('\n');
    let inDefinition = -1;
    let previousSite = -1;
    lines.forEach((line, index) => {
      if (DEFINITIONS.some((re) => re.test(line))) {
        inDefinition = index;
        return;
      }
      // The body of a definition (its own `permissionDecision: 'deny'`).
      if (inDefinition >= 0 && index - inDefinition <= 12) {
        if (/^\}/u.test(line)) inDefinition = -1;
        return;
      }
      if (/^\s*(?:\/\/|\*|import\b)|^\s*stopPrompt,$/u.test(line)) return;
      if (!DENY_SITE.test(line)) return;
      // The comment must sit between the previous site and this one, so one
      // comment never covers two denials.
      let code = null;
      const floor = Math.max(previousSite + 1, index - 12, 0);
      previousSite = index;
      for (let back = index; back >= floor; back -= 1) {
        const match = /\/\/ deny-inventory: ([a-z0-9-]+)/u.exec(lines[back]);
        if (match) {
          code = match[1];
          break;
        }
      }
      found.push({ where: `${file}:${index + 1}`, code });
    });
  }
  return found;
}

test('every deny or stop site is in the inventory, with an allowed kind', () => {
  const all = sites();
  assert.ok(all.length >= 20, `found only ${all.length} deny sites`);
  for (const { where, code } of all) {
    assert.ok(code, `${where} denies without a // deny-inventory: comment`);
    assert.ok(
      INVENTORY[code],
      `${where}: "${code}" is a new denial reason; add it to INVENTORY with a principles justification`,
    );
  }
  for (const [code, [kind, why]] of Object.entries(INVENTORY)) {
    assert.ok(KINDS.has(kind), `${code}: unknown kind ${kind}`);
    assert.ok(why.length > 0, `${code}: justification missing`);
  }
});

test('the inventory has no stale entries', () => {
  const used = new Set(sites().map(({ code }) => code));
  for (const code of Object.keys(INVENTORY))
    assert.ok(used.has(code), `${code} is listed but no code site uses it`);
});

test('no stop is left open for an owner decision', () => {
  const open = Object.entries(INVENTORY)
    .filter(([, [kind]]) => kind === 'open')
    .map(([code]) => code);
  assert.deepEqual(open, []);
});
