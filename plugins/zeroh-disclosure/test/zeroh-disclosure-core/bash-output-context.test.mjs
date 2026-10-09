// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bashOutputSegments,
  bashOutputFindings,
  scrubBashResponse,
  outputRecoveryBudget,
  memoizeOutputFindings,
} from '../../packages/zeroh-disclosure-core/bash-output-context.js';
import { detectSensitiveData } from '../../packages/zeroh-disclosure-core/detector.js';
import { loadavg } from 'node:os';
import { outputFindingMemos } from '../../lib/hook-steps/post-tool-use/recovery-notice.js';
const context = (text, command) =>
  bashOutputSegments(text, command).map((s) => [
    s.options.channel,
    s.options.context,
  ]);
for (const command of [
  'cat fake.py',
  'head -n 5 fake.py',
  'tail -n 5 fake.py',
  'less fake.py',
  'cat fake.py other.py',
  "cat 'fake.py'",
  'cat -- fake.py',
  "cat 'fake  spaced.py'",
])
  test(`Bash recovery: ${command}`, () =>
    assert.deepEqual(context('password="ZEROHFAKE9!"', command), [
      ['code', 'python'],
    ]));
test('quoted native paths follow Bash escaping on every OS', () => {
  for (const command of [
    String.raw`cat "D:\a\x\fake.py"`,
    String.raw`cat 'D:\a\x\fake.py'`,
    String.raw`cat "D:\a\x\fake\$literal.py"`,
    String.raw`cat "D:\a\x\fake\\literal.py"`,
    String.raw`cat "D:\a\x\fake\"literal.py"`,
    String.raw`cat "D:\a\x\fake\`literal.py"`,
    String.raw`cat 'D:\a\x\fake$literal.py'`,
  ])
    assert.deepEqual(
      context('ordinary', command),
      [['code', 'python']],
      command,
    );
  for (const command of [
    String.raw`cat D:\a\x\fake.py`,
    String.raw`cat "D:\a\x\file-$FILE.py"`,
    'cat "D:\\a\\x\\`echo fake`.py"',
    String.raw`cat "D:\a\x\fake.py"; echo done`,
    String.raw`cat "D:\a\x\fake.py" | less`,
    String.raw`cat "D:\a\x\fake.py`,
  ])
    assert.deepEqual(
      context('ordinary', command),
      [['prose', 'mixed']],
      command,
    );
});

test('head/tail output headers recover multiple file grammars in order', () => {
  for (const command of ['head fake.py fake.js', 'tail fake.py fake.js']) {
    const segments = bashOutputSegments(
      '==> fake.py <==\npassword="ZEROHFAKE9!"\n==> fake.js <==\nconst password="ZEROHFAKE8!"\n',
      command,
    );
    assert.deepEqual(
      segments.map((s) => s.options.context),
      ['mixed', 'python', 'mixed', 'javascript'],
    );
    assert.equal(
      segments.map((s) => s.text).join(''),
      '==> fake.py <==\npassword="ZEROHFAKE9!"\n==> fake.js <==\nconst password="ZEROHFAKE8!"\n',
    );
  }
});
test('ambiguous or composed reader output retains unknown grammar', () => {
  for (const command of [
    'cat fake.py fake.js',
    'cat "$FILE"',
    'cat *.py',
    'cat fake.py | less',
    'cat fake.py; echo done',
    'cat -n fake.py',
    'cat fake.py > file',
    'cat -',
  ])
    assert.deepEqual(context('ordinary', command), [['prose', 'mixed']]);
});
test('git diff/show resets grammar for each file and hunk', () => {
  const text =
    'diff --git a/fake.py b/fake.py\n+++ b/fake.py\n@@ -1 +1 @@\n+password="ZEROHFAKE9!"\ndiff --git a/fake.js b/fake.js\n+++ b/fake.js\n@@ -1 +1 @@\n+const password="ZEROHFAKE8!"\n';
  for (const command of ['git diff', 'git show HEAD', '/usr/bin/git diff']) {
    assert.deepEqual(
      context(text, command).map(([, c]) => c),
      ['mixed', 'python', 'mixed', 'javascript'],
    );
    assert.equal(
      scrubBashResponse({ stdout: text, stderr: 'ordinary' }, command, (v) => v)
        .stdout,
      text,
      'all prefixes and line breaks preserved',
    );
  }
});
test('grep/rg filename grammar is independent per line', () => {
  const text =
    'fake.py:3:password="ZEROHFAKE9!"\nfake.js:4:const password="ZEROHFAKE8!"\n';
  for (const command of [
    'grep -rn password src',
    'grep -r -n password src',
    'rg -n password src',
  ]) {
    assert.deepEqual(context(text, command), [
      ['code', 'python'],
      ['code', 'javascript'],
    ]);
    assert.equal(
      scrubBashResponse({ stdout: text }, command, (v) => v).stdout,
      text,
    );
  }
});
test('MCP/test-like and malformed headers never supply grammar', () => {
  for (const [text, command] of [
    ['FAIL fake.py\nordinary', 'pnpm test'],
    ['fake.py:no-line:ordinary', 'rg password'],
    ['+++ "b/fake.py"\nordinary', 'git diff'],
  ])
    assert.deepEqual(context(text, command), [['prose', 'mixed']]);
});

test('diff Markdown removes transport prefixes while preserving presentation grammar', () => {
  const text =
    'diff --git a/fake.md b/fake.md\n+++ b/fake.md\n@@ -1 +1 @@\n+DB_PASSWORD=ZEROHFAKE9!\n';
  const findings = bashOutputFindings(text, 'git diff', { profile: 'secrets' });
  const start = text.indexOf('ZEROH' + 'FAKE9!');
  assert.ok(findings.some((f) => f.start <= start && f.end >= start + 11));
});

test('malformed diff headers reset the previous file grammar', () => {
  const text =
    '+++ b/fake.py\n@@ -1 +1 @@\n+ordinary\ndiff --git "a/quoted.js" "b/quoted.js"\n@@ -1 +1 @@\n+ordinary\n';
  assert.deepEqual(
    bashOutputSegments(text, 'git diff').map((s) => s.options.context),
    ['mixed', 'python', 'mixed'],
  );
});

test('recovery budgets retain the full unknown scan after work or time exhaustion', () => {
  const fake = 'ZEROH' + 'FAKE9!';
  const text = `fake.js:1:password="fake.js:123:${fake}"\nfake.js:2:curl -u "admin:${fake}"\n`;
  const options = { profile: 'secrets' };
  const unknown = detectSensitiveData(text, options);
  assert.ok(unknown.length, 'unsplit scan protects the trailing credential');
  for (const limit of [{ work: 0 }, { deadline: 0 }]) {
    const findings = bashOutputFindings(text, 'rg -n . fake.js', options, {
      ...outputRecoveryBudget(),
      ...limit,
    });
    assert.deepEqual(
      findings,
      unknown,
      'budget exhaustion preserves original findings',
    );
  }
  const findings = bashOutputFindings(text, 'rg -n . fake.js', options, {
    ...outputRecoveryBudget(),
    work:
      Buffer.byteLength(text) +
      Buffer.byteLength(text.split('\n')[0] + '\n') +
      128,
  });
  const first = text.indexOf('fake.js:123:');
  assert.ok(
    findings.some(
      (f) => f.start <= first && f.end >= first + `fake.js:123:${fake}`.length,
    ),
    'completed recovery retained',
  );
  for (const f of unknown)
    assert.ok(
      findings.some((r) => r.start <= f.start && r.end >= f.end),
      'later unknown protection retained',
    );
});

test('recovery skips work beyond its allowance without splitting a line or Unicode', () => {
  const text =
    'ordinary '.repeat(20000) + '\n' + 'curl -u "admin:ZEROHFAKE9!"\n';
  const budget = { ...outputRecoveryBudget(), work: 64 };
  const options = { profile: 'secrets' };
  assert.deepEqual(
    bashOutputFindings(text, 'rg -n . fake.js', options, budget),
    detectSensitiveData(text, options),
  );
  assert.equal(budget.work, 64, 'oversize fragment skipped');
  const unicode = 'fake.js:1:const label = "😀";\n'.repeat(100);
  const unicodeBudget = { ...outputRecoveryBudget(), work: 100 };
  assert.deepEqual(
    bashOutputFindings(unicode, 'rg -n . fake.js', options, unicodeBudget),
    [],
  );
  assert.ok(unicodeBudget.work >= 0);
});

test('recovery work is measured deterministically through the 1 MiB cutoff', (t) => {
  const text = 'a.js:1:const x = 1;\n'.repeat(50000);
  assert.ok(Buffer.byteLength(text) < 1024 * 1024);
  const budget = outputRecoveryBudget();
  const started = performance.now();
  assert.deepEqual(
    bashOutputFindings(text, 'rg -n . a.js', { profile: 'secrets' }, budget),
    [],
  );
  t.diagnostic(
    `cutoff recovery: ${(performance.now() - started).toFixed(1)} ms; work ${budget.workUsed}; detector calls ${budget.detectorCalls}; load ${loadavg().join('/')}`,
  );
  assert.equal(
    budget.scannedBytes,
    Buffer.byteLength('a.js:1:') + Buffer.byteLength('const x = 1;\n'),
  );
  assert.equal(
    budget.detectorCalls,
    2,
    'identical fragments reuse results within this scan',
  );
  assert.ok(budget.workUsed > 0 && budget.workUsed <= 2 * 1024 * 1024);
});

test('recovery uses a 2 MiB work allowance', () => {
  assert.equal(outputRecoveryBudget().work, 2097152);
});

test('slow startup still admits cheap recovery before the watchdog reserve', () => {
  const text =
    'fake.js:1:password="fake.js:123:ZEROHFAKE9!"\n' +
    'fake.js:2:curl -u "admin:ZEROHFAKE8!"\n';
  const options = { profile: 'secrets' };
  const budget = outputRecoveryBudget({ hookStart: 0, now: () => 8500 });
  const findings = bashOutputFindings(text, 'rg -n . fake.js', options, budget);
  assert.ok(findings.length > detectSensitiveData(text, options).length);
  assert.ok(budget.detectorCalls > 0);
  assert.equal(budget.truncated, false);
  assert.equal(budget.deadline, 10500);
});

for (const [unknownEnd, deadline] of [
  [9000, 10500],
  [9500, 10500],
])
  test(`recovery stops on the injected clock at ${deadline} ms`, () => {
    let budget;
    const text =
      'fake.js:1:password="fake.js:123:ZEROHFAKE9!"\n' +
      'other.js:2:password="other.js:456:ZEROHFAKE8!"\n' +
      'other.js:3:curl -u "admin:ZEROHFAKE7!"\n';
    budget = outputRecoveryBudget({
      hookStart: 0,
      now: () => (budget?.detectorCalls >= 2 ? deadline + 1 : unknownEnd),
    });
    const options = { profile: 'secrets' };
    const unknown = detectSensitiveData(text, options);
    const findings = bashOutputFindings(
      text,
      'rg -n . fake.js',
      options,
      budget,
    );
    assert.equal(budget.deadline, deadline);
    assert.equal(budget.truncated, true);
    assert.equal(budget.detectorCalls, 2, 'no calls after deadline');
    const first = text.indexOf('fake.js:123:');
    assert.ok(
      findings.some((f) => f.start <= first && f.end > first),
      'completed recovery kept',
    );
    const second = text.indexOf('other.js:456:');
    assert.ok(
      !findings.some((f) => f.start <= second && f.end > second),
      'later recovery skipped',
    );
    for (const f of unknown)
      assert.ok(
        findings.some((r) => r.start <= f.start && r.end >= f.end),
        'unknown retained',
      );
  });

test('recovery can complete after unknown end plus three seconds', () => {
  let reads = 0;
  const budget = outputRecoveryBudget({
    hookStart: 0,
    now: () => (++reads <= 2 ? 1000 : 6500),
  });
  const text = 'fake.js:1:password="fake.js:123:ZEROHFAKE9!"\n';
  const findings = bashOutputFindings(
    text,
    'rg -n . fake.js',
    { profile: 'secrets' },
    budget,
  );
  assert.equal(budget.deadline, 10500);
  assert.ok(
    findings.some(
      (f) =>
        f.start <= text.indexOf('fake.js:123:') &&
        f.end > text.indexOf('fake.js:123:'),
    ),
    'late recovery kept',
  );
});

for (const duration of [100, 1900, 2000, 5000])
  test(`recovery call admission uses measured UTF-8 rate (${duration} ms unknown scan)`, () => {
    let reads = 0;
    const text =
      'const label = "😀";\n'.repeat(100) + 'curl -u "admin:ZEROHFAKE9!"\n';
    const options = { profile: 'secrets' };
    const budget = outputRecoveryBudget({
      hookStart: 0,
      now: () => (++reads === 1 ? 0 : reads === 2 ? duration : 5800),
    });
    budget.deadline = 8000;
    const unknown = detectSensitiveData(text, options);
    const findings = bashOutputFindings(text, 'cat fake.js', options, budget);
    assert.equal(
      budget.detectorCalls,
      2 * duration < 2200 - budget.tailReserve(Buffer.byteLength(text)) ? 1 : 0,
      'only calls estimated to fit may start',
    );
    if (budget.truncated)
      assert.deepEqual(
        findings,
        unknown,
        'unknown results kept when recovery cannot fit',
      );
  });

test('finding memo preserves completed recovery after expiry and keys all options', () => {
  let time = 0;
  let calls = 0;
  const budget = outputRecoveryBudget({ hookStart: 0, now: () => time });
  const text = 'fake.js:1:password="fake.js:123:ZEROHFAKE9!"\n';
  const detect = memoizeOutputFindings((value, options) => {
    calls += 1;
    return bashOutputFindings(value, 'rg -n . fake.js', options, budget);
  });
  const first = detect(text, { profile: 'secrets' });
  assert.ok(first.length > 0, 'fixture needs recovered findings');
  assert.equal(detectSensitiveData(text, { profile: 'secrets' }).length, 0);
  time = 12000;
  const work = budget.workUsed;
  assert.deepEqual(detect(text, { profile: 'secrets' }), first);
  assert.equal(calls, 1, 'same detector input does not scan twice');
  assert.equal(budget.workUsed, work, 'memo hit spends no recovery allowance');
  assert.deepEqual(detect(text, { profile: 'tool' }), []);
  assert.equal(calls, 2, 'different options require their own scan');
  detect(text + 'ordinary', { profile: 'secrets' });
  assert.equal(calls, 3, 'different text requires its own scan');
});

test('every recovery denial records truncation while retaining the unknown scan', () => {
  const text = 'fake.js:1:password="fake.js:123:ZEROHFAKE9!"\n';
  for (const override of [
    { work: 0 },
    { work: Buffer.byteLength(text) + 1 },
    { deadline: 0 },
  ]) {
    const budget = { ...outputRecoveryBudget(), ...override };
    bashOutputFindings(text, 'rg -n . fake.js', { profile: 'secrets' }, budget);
    assert.equal(budget.truncated, true);
  }
  const parsingBudget = outputRecoveryBudget({
    hookStart: 0,
    now: () => 12000,
  });
  bashOutputSegments(text, 'rg -n . fake.js', parsingBudget);
  assert.equal(parsingBudget.truncated, true, 'parser cut recorded too');
});

test('fallback memo miss does not mark a completed recovery as truncated', () => {
  const budget = outputRecoveryBudget({ hookStart: 0, now: () => 0 });
  let fallback = false;
  const findingsFor = outputFindingMemos(budget, () => fallback);
  const context = {
    detectFindings: (text, options) =>
      bashOutputFindings(text, 'rg -n . fake.js', options, budget),
  };
  const options = { profile: 'secrets' };
  const text = 'fake.js:1:password="fake.js:123:ZEROHFAKE9!"\n';
  assert.ok(findingsFor(context)(text, options).length);
  fallback = true;
  assert.ok(findingsFor(context)('ordinary\n' + text, options).length);
  assert.equal(
    budget.truncated,
    false,
    'changed fallback input completed recovery',
  );
  budget.work = 0;
  findingsFor(context)('more ordinary\n' + text, options);
  assert.equal(
    budget.truncated,
    true,
    'incomplete fallback recovery still noticed',
  );
  budget.work = 2097152;
  findingsFor(context)('another ordinary\n' + text, options);
  assert.equal(budget.truncated, true, 'other incomplete text remains sticky');
});
