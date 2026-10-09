// SPDX-License-Identifier: AGPL-3.0-only

// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  createBashParser,
  nodesOfType,
  parseWithBashParser,
} from './parsers/bash-adapter.mjs';
import {
  gateVerdict,
  checkCstIdentity,
  percentiles,
  validateColdProcess,
  validateHookSample,
} from './parsers/benchmark.mjs';
import { passAnswer, timeoutError } from '../../hooks/fail-closed.js';
import { parsePowerShellCommands } from './parsers/powershell-adapter.mjs';
import { monorepoOnly } from '../monorepo.mjs';
import { freshEnvironment } from './destinations/isolation.mjs';

test('parser adapters are byte-for-byte pinned upstream artifacts', () => {
  const source = new URL('./parsers/vendor/SOURCE.json', import.meta.url);
  const manifest = JSON.parse(readFileSync(source, 'utf8'));
  assert.deepEqual(
    manifest.packages.map((row) => [row.package, row.version]),
    [
      ['web-tree-sitter', '0.27.0'],
      ['tree-sitter-bash', '0.25.1'],
    ],
  );
  const pinned = {
    'runtime/web-tree-sitter.js':
      '7c49e3c1d87e24e0bb4c2def909d17154dfde281f5f8280225450090bb4b8110',
    'runtime/web-tree-sitter.wasm':
      'c03bccdc3b448a32848f5ae327e209c982bbb0840d43eec8bc2d5759544a1ed3',
    'bash/tree-sitter-bash.wasm':
      '8292919c88a0f7d3fb31d0cd0253ca5a9531bc1ede82b0537f2c63dd8abe6a7a',
  };
  for (const artifact of manifest.packages) {
    assert.equal(artifact.license, 'MIT');
    assert.match(artifact.integrity, /^sha512-/);
    for (const file of artifact.files) {
      const digest = createHash('sha256')
        .update(
          readFileSync(
            new URL(`./parsers/vendor/${file.path}`, import.meta.url),
          ),
        )
        .digest('hex');
      assert.equal(digest, file.sha256);
      if (pinned[file.path]) assert.equal(digest, pinned[file.path]);
    }
  }
});

test('real Bash CST distinguishes literal concatenation, comments, and parse failure', async () => {
  const parser = await createBashParser();
  try {
    const result = parseWithBashParser(parser, 'printf --p"re"=x # --%');
    assert.equal(result.hasError, false);
    assert.equal(
      nodesOfType(result.root, 'concatenation')[0].text,
      '--p"re"=x',
    );
    assert.equal(nodesOfType(result.root, 'comment')[0].text, '# --%');
    assert.equal(parseWithBashParser(parser, 'if then').hasError, true);
  } finally {
    parser.delete();
  }
});

test('twenty cold samples use nearest-rank percentiles and reject incomplete data', () => {
  assert.deepEqual(
    percentiles(Array.from({ length: 20 }, (_, index) => 20 - index)),
    { count: 20, p50Ms: 10, p95Ms: 19 },
  );
  assert.throws(() => percentiles([1, 2, 3]), /Twenty/);
  assert.throws(
    () => percentiles(Array.from({ length: 20 }, () => NaN)),
    /Twenty/,
  );
});

test('parser and actual-hook gates are independent and exact thresholds fail', () => {
  assert.equal(
    gateVerdict({ p50Ms: 299, p95Ms: 450 }, { p95Ms: 650 }, 'bash', null, {
      p95Ms: 500,
    }).releasePassed,
    true,
  );
  assert.equal(
    gateVerdict({ p50Ms: 300, p95Ms: 350 }, { p95Ms: 200 }, 'bash', null, {
      p95Ms: 100,
    }).parserPassed,
    false,
  );
  assert.equal(
    gateVerdict({ p50Ms: 100, p95Ms: 200 }, { p95Ms: 1000 }, 'bash', null, {
      p95Ms: 900,
    }).wholeHookPassed,
    false,
  );
  assert.equal(
    gateVerdict({ p95Ms: 2499 }, { p95Ms: 2999 }, 'powershell').releasePassed,
    true,
  );
  assert.equal(
    gateVerdict({ p95Ms: 2500 }, { p95Ms: 2000 }, 'powershell').releasePassed,
    false,
  );
});

test('a slow parser cannot claim the 1.0 fallback without correctness and notice proof', () => {
  const parser = { p50Ms: 301, p95Ms: 350 };
  const hook = { p95Ms: 301 };
  assert.equal(
    gateVerdict(parser, hook, 'bash').decision,
    'blocked-unverified-1.0-fallback',
  );
  assert.equal(
    gateVerdict(parser, hook, 'bash', { correctnessPassed: true })
      .releasePassed,
    false,
  );
  assert.equal(
    gateVerdict(parser, hook, 'bash', {
      correctnessPassed: true,
      noticePassed: true,
    }).decision,
    'verified-1.0-fallback',
  );
});

test('a real watchdog pass answer cannot masquerade as a successful timed hook', () => {
  const event = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'printf ZEROHFAKE' },
  });
  const answer = passAnswer(
    'pre-tool-use',
    event,
    { emitted: false, cleared: false },
    timeoutError(8000),
  );
  assert.equal(answer.code, 0, 'actual pass-mode watchdog exits successfully');
  const result = {
    status: answer.code,
    stdout: answer.stdout,
    stderr: answer.stderr,
  };
  assert.throws(
    () => validateHookSample(result, { parsed: true }, 100),
    /watchdog/,
  );
  const failure = passAnswer(
    'pre-tool-use',
    event,
    { emitted: false, cleared: false },
    new Error('fixture parser failure'),
  );
  assert.throws(
    () =>
      validateHookSample(
        {
          status: failure.code,
          stdout: failure.stdout,
          stderr: failure.stderr,
        },
        { parsed: true },
        100,
      ),
    /failure/,
  );
  assert.doesNotThrow(() =>
    validateHookSample(
      { status: 0, stdout: '', stderr: '' },
      { parsed: true },
      100,
    ),
  );
});

test('one overdue cold sample fails even when nineteen fast samples keep p95 small', () => {
  const times = [...Array(19).fill(100), 8000];
  assert.equal(percentiles(times).p95Ms, 100);
  assert.throws(
    () => validateColdProcess({ status: 0 }, times[19]),
    /deadline/,
  );
  assert.throws(
    () =>
      validateHookSample(
        { status: 0, stdout: '' },
        { parsed: true },
        times[19],
      ),
    /deadline/,
  );
  assert.throws(
    () => validateHookSample({ status: 0, stdout: '' }, { parsed: false }, 100),
    /marker/,
  );
});

test(
  'PowerShell expandable strings with no nested tokens and braced references both serialize',
  {
    skip:
      process.env.ZEROH_DESTINATION_ORACLES !== '1' &&
      'Dedicated destination CI or explicit opt-in only',
  },
  (context) => {
    const fixture = freshEnvironment('parser-serialization');
    try {
      const available = spawnSync(
        'pwsh',
        ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'],
        { env: fixture.env, timeout: 8000 },
      );
      if (available.error || available.status !== 0) {
        context.skip(
          'pwsh unavailable in this unit environment; destination CI requires it on PowerShell legs',
        );
        return;
      }
      const commands = [
        'curl "X: --% ZEROHFAKEvalue"',
        'curl "${STRIPE_KEY}_SUFFIX"',
        "curl @'\nZEROHFAKEvalue\n'@",
      ];
      const parsed = parsePowerShellCommands(commands, { env: fixture.env });
      assert.equal(parsed.results.length, commands.length);
      assert.ok(parsed.results.every((row) => row.errors.length === 0));
      const literal = parsed.results[0].tokens.find(
        (row) => row.kind === 'StringExpandable',
      );
      assert.ok(literal);
      assert.deepEqual(literal.nestedTokens, []);
      const reference = parsed.results[1].tokens.find(
        (row) => row.kind === 'StringExpandable',
      );
      assert.equal(reference.nestedTokens[0].kind, 'Variable');
      assert.equal(reference.nestedTokens[0].text, '${STRIPE_KEY}');
      assert.ok(
        parsed.results[2].tokens.some(
          (row) => row.kind === 'HereStringLiteral',
        ),
      );
    } finally {
      fixture.cleanup();
    }
  },
);

test(
  'Liftoff and default tiers produce identical sixty-command CST snapshots',
  { skip: monorepoOnly('isolated destination CI/test environment') },
  () => {
    const result = checkCstIdentity();
    assert.equal(result.identical, true);
    assert.equal(result.count, 60);
    assert.equal(result.defaultSha256, result.liftoffSha256);
  },
);

test('whole hook may add at most 150 ms to same-runner no-adapter p95', () => {
  const parser = { p50Ms: 100, p95Ms: 500 };
  assert.equal(
    gateVerdict(parser, { p95Ms: 651 }, 'bash', null, { p95Ms: 500 })
      .wholeHookPassed,
    false,
  );
  assert.equal(
    gateVerdict(parser, { p95Ms: 650 }, 'bash', null, { p95Ms: 500 })
      .adapterPassed,
    true,
  );
  assert.equal(
    gateVerdict(parser, { p95Ms: 400 }, 'bash').wholeHookPassed,
    false,
  );
});
