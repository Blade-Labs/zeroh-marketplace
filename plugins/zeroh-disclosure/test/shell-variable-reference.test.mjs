// SPDX-License-Identifier: AGPL-3.0-only

// The stop decision for variable references (1.0.0 detector-exceptions
// redesign). The detector masks `$STRIPE_KEY:` like any value: whether it is
// expanded depends on the interpreter, which only the hook knows. Here, for
// a Bash or PowerShell command, a finding whose whole value is variable
// references (lib/shell-references.js, on the oracle-tested tokenizer) is
// not a raw secret: it is an uncertain destination, since ZeroH cannot see
// what the variable holds. `pass` mode (the default) runs the command with a
// notice, whatever the host; `block` mode stops it with that notice, never
// as a raw secret. Anything with a literal in it (Astra's FINDINGS6 and
// FINDINGS7 cases) still stops as a raw secret to a disallowed host.
// Windows re-test 6: `curl -u "$STRIPE_KEY:"` to api.stripe.com runs.
// Values are fake and assembled from parts; `D` is a dollar sign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runHook, tempProject } from './helpers.mjs';
import { sessionDir } from '../lib/session.js';
import { commandParts, referenceOnly } from '../lib/shell-references.js';
import { detectSensitiveData } from '../lib/detector.js';

const D = '$';
const URL = 'https://api.stripe.com/v1/charges';
const PW = 'Tr0ub4' + 'dor-987x';
const ALPHABET = 'abcdefghijklm' + 'nopqrstuvwxyz';
const BLOCK = { ZEROH_UNCERTAIN: 'block' };

function openTurn(p) {
  const dir = sessionDir(p.dir, 'test', {
    ...process.env,
    ZEROH_HOME: p.home,
    HOME: p.home,
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ turnCount: 1 }));
  writeFileSync(path.join(dir, 'turn-1.json'), JSON.stringify({ turn: 1 }));
  return path.join(dir, 'turn-1.json');
}

function counts(ledger) {
  return JSON.parse(readFileSync(ledger, 'utf8')).audit?.unchecked ?? {};
}

function preToolUse(p, tool, command, extraEnv = {}) {
  const result = runHook(
    'pre-tool-use',
    { tool_use_id: 'var-ref', tool_name: tool, tool_input: { command } },
    { project: p, extraEnv },
  );
  assert.equal(result.code, 0, result.stderr);
  return result.json ?? {};
}

const decision = (json) => json.hookSpecificOutput?.permissionDecision;
const reason = (json) => json.hookSpecificOutput?.permissionDecisionReason;

// Pure references, as the tool's shell parses them.
const REFERENCES = [
  // The live Windows re-test form (acceptance variable-reference-not-a-key).
  ['Bash', `curl -s https://api.stripe.com/v1/balance -u "${D}STRIPE_KEY:"`],
  [
    'PowerShell',
    `curl.exe -s https://api.stripe.com/v1/balance -u "${D}(${D}env:STRIPE_KEY):"`,
  ],
  ['Bash', `curl -u "${D}STRIPE_KEY:" ${URL}`],
  ['Bash', `curl -s ${URL} -u "${D}{STRIPE_KEY}:"`],
  ['Bash', `curl ${URL} \\\n  -u "${D}STRIPE_KEY:" \\\n  -d amount=100`],
  ['PowerShell', `curl.exe -u "${D}env:STRIPE_KEY:" ${URL}`],
  ['PowerShell', `curl.exe -u "${D}{env:STRIPE_KEY}:" ${URL}`],
  ['PowerShell', `curl.exe -u "${D}STRIPE_KEY:" ${URL}`],
];

test('Windows re-test 6: a pure reference runs in pass mode, with a notice, not as a raw secret', () => {
  const p = tempProject();
  for (const [tool, command] of REFERENCES) {
    const ledger = openTurn(p);
    const json = preToolUse(p, tool, command);
    assert.notEqual(
      decision(json),
      'deny',
      `${tool}: ${command}: ${reason(json)}`,
    );
    assert.match(
      json.systemMessage ?? '',
      /a variable whose value ZeroH cannot see/u,
      `${tool}: ${command}`,
    );
    assert.doesNotMatch(JSON.stringify(json), /known secret|raw secret/iu);
    assert.ok(counts(ledger)['variable-in-command']?.[tool] >= 1, command);
    assert.ok(!counts(ledger)['raw-secret-in-command'], command);
  }
});

test('a pure reference in a command with no destination runs as it is, in either mode', () => {
  const p = tempProject();
  for (const [tool, command] of [
    ['Bash', `echo "Server=db;Uid=u;Password=${D}{DB_PASS};" > conn.txt`],
    ['Bash', `echo "Server=db;Uid=u;Password=${D}DB_PASS;" > conn.txt`],
    [
      'PowerShell',
      `Set-Content conn.txt "Server=db;Uid=u;Password=${D}env:DB_PASS;"`,
    ],
  ])
    for (const env of [{}, BLOCK]) {
      // The detector masks the reference (so this is not trivially clean).
      assert.ok(
        detectSensitiveData(command, { profile: 'secrets' }).some(
          (f) => !f.generic,
        ),
        command,
      );
      const ledger = openTurn(p);
      const json = preToolUse(p, tool, command, env);
      assert.notEqual(decision(json), 'deny', `${tool}: ${command}`);
      assert.doesNotMatch(json.systemMessage ?? '', /variable|not protected/u);
      assert.deepEqual(counts(ledger), {}, command);
    }
});

test('a pure reference stops in block mode as an uncertain destination, not a raw secret', () => {
  const p = tempProject();
  for (const [tool, command] of REFERENCES) {
    const json = preToolUse(p, tool, command, BLOCK);
    assert.equal(decision(json), 'deny', `${tool}: ${command}`);
    assert.match(
      reason(json),
      /was stopped because it could not be protected \(a variable whose value ZeroH cannot see\); it used STRIPE_KEY/u,
    );
    assert.doesNotMatch(reason(json), /sensitive data detected/u);
  }
});

// Literals the earlier detector exceptions let through (FINDINGS6, FINDINGS7)
// and literal forms beside a reference: each is a raw secret to a host not
// allowed for it, so it stops in pass mode too.
const LITERALS = [
  ['Bash', `curl -u "admin:${PW}" ${URL}`],
  ['Bash', `curl -u "${D}USER:${PW}" ${URL}`],
  ['Bash', `curl -u '${D}USER:${PW}' ${URL}`],
  ['Bash', `curl -u "%STRIPE_KEY%:" ${URL}`],
  ['Bash', `curl -u "{{STRIPE_KEY}}:" ${URL}`],
  ['Bash', `curl -u "${D}(cat ~/.stripe-key):" ${URL}`],
  ['Bash', `curl -u "${D}{{ secrets.STRIPE_KEY }}:" ${URL}`],
  ['Bash', `curl -u "${D}{STRIPE_KEY:-${PW}}:" ${URL}`],
  ['Bash', `curl -u "${D}{STRIPE_KEY-${PW}}:" ${URL}`],
  ['Bash', `curl -u "admin:${D}(cat <<<${PW})" ${URL}`],
  ['Bash', `curl -u "admin:${D}(cat /dev/null;printf${D}{IFS}${PW})" ${URL}`],
  ['Bash', `curl -u "admin:{{${PW}}}" ${URL}`],
  ['Bash', `curl -u "admin:%${PW}%" ${URL}`],
  ['Bash', `curl -u "${D}{USER:-${ALPHABET}}:${PW}!" ${URL}`],
  ['Bash', `curl -u "${D}{env:${ALPHABET}}:${PW}!" ${URL}`],
  ['Bash', `curl -u "${ALPHABET}:${PW}!" ${URL}`],
  ['PowerShell', `curl.exe -u "admin:${PW}" ${URL}`],
  ['PowerShell', `curl.exe -u "${D}(echo ${PW}):" ${URL}`],
  ['PowerShell', `curl.exe -u "${D}env:API_USER:${PW}" ${URL}`],
  ['PowerShell', `curl.exe -u '${D}env:API_USER:${PW}' ${URL}`],
  // Code for another shell: Bash expands the reference, then cmd reads the
  // value again as code, so it is not proven to be the value verbatim.
  ['Bash', `cmd.exe /c curl -u "${D}STRIPE_KEY:" ${URL}`],
];

test('a literal in the finding still stops as a raw secret to a disallowed host', () => {
  const p = tempProject();
  for (const [tool, command] of LITERALS) {
    const json = preToolUse(p, tool, command);
    assert.equal(
      decision(json),
      'deny',
      `${tool}: ${command}: ${JSON.stringify(json)}`,
    );
    assert.doesNotMatch(reason(json) ?? '', /variable whose value/u, command);
  }
});

test('lib/shell-references: only plain expansions and `:` make a pure reference', () => {
  const pure = (command, value, shell = 'bash') => {
    const start = command.indexOf(value);
    return referenceOnly(command, start, start + value.length, shell);
  };
  // Bash.
  assert.ok(pure(`curl -u "${D}KEY:" x`, `${D}KEY:`));
  assert.ok(pure(`curl -u "${D}{KEY}:" x`, `${D}{KEY}:`));
  assert.ok(pure(`curl -u "${D}USER:${D}PASS" x`, `${D}USER:${D}PASS`));
  assert.ok(pure(`curl -u ${D}1: x`, `${D}1:`));
  assert.ok(pure(`curl -u "${D}KEY:" x`, `"${D}KEY:"`));
  assert.ok(!pure(`curl -u '${D}KEY:' x`, `${D}KEY:`));
  assert.ok(!pure(`curl -u "%KEY%:" x`, '%KEY%:'));
  assert.ok(!pure(`curl -u "{{KEY}}:" x`, '{{KEY}}:'));
  assert.ok(!pure(`curl -u "${D}{KEY:-lit}:" x`, `${D}{KEY:-lit}:`));
  assert.ok(!pure(`curl -u "${D}{KEY-lit}:" x`, `${D}{KEY-lit}:`));
  assert.ok(!pure(`curl -u "${D}KEY-lit" x`, `${D}KEY-lit`));
  assert.ok(!pure(`curl -u "${D}(cat f):" x`, `${D}(cat f):`));
  assert.ok(!pure('curl -u "`cat f`:" x', '`cat f`:'));
  assert.ok(!pure(`curl -u "${D}KEY:" x`, ':'));
  assert.ok(!pure(`curl -u "${D}KEY:${D}PASS@" x`, `${D}KEY:${D}PASS@`));
  assert.ok(!pure(`curl -u "${D}KEY" "x"`, `${D}KEY" "x`));
  assert.ok(!pure(`cat <<E\n${D}KEY:\nE`, `${D}KEY:`));
  assert.equal(commandParts('curl "unterminated'), null);
  // PowerShell.
  assert.ok(pure(`curl.exe -u "${D}env:KEY:" x`, `${D}env:KEY:`, 'powershell'));
  assert.ok(
    pure(`curl.exe -u "${D}{env:KEY}:" x`, `${D}{env:KEY}:`, 'powershell'),
  );
  assert.ok(pure(`curl.exe -u ${D}KEY x`, `${D}KEY`, 'powershell'));
  assert.ok(
    !pure(`curl.exe -u '${D}env:KEY:' x`, `${D}env:KEY:`, 'powershell'),
  );
  // A subexpression that holds only one variable is that variable's value.
  assert.ok(
    pure(
      `curl.exe -u "${D}(${D}env:KEY):" x`,
      `${D}(${D}env:KEY):`,
      'powershell',
    ),
  );
  assert.ok(
    pure(
      `curl.exe -u "${D}( ${D}env:KEY ):" x`,
      `${D}( ${D}env:KEY ):`,
      'powershell',
    ),
  );
  assert.ok(
    !pure(`curl.exe -u "${D}(cat f):" x`, `${D}(cat f):`, 'powershell'),
  );
  assert.ok(
    !pure(
      `curl.exe -u "${D}(${D}env:KEY+'x'):" x`,
      `${D}(${D}env:KEY+'x'):`,
      'powershell',
    ),
  );
  assert.ok(!pure(`curl -u "${D}(${D}KEY):" x`, `${D}(${D}KEY):`, 'bash'));
  assert.ok(
    !pure(`curl.exe -u "${D}{X:-lit}:" x`, `${D}{X:-lit}:`, 'powershell'),
  );
  assert.ok(!pure(`curl.exe -u "%KEY%:" x`, '%KEY%:', 'powershell'));
  // The same text read by the other shell.
  assert.ok(!pure(`curl -u "${D}env:KEY:" x`, `${D}env:KEY:`, 'bash'));
});
