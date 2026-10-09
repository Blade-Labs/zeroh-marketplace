// SPDX-License-Identifier: AGPL-3.0-only

// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, copyFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { freshEnvironment } from '../destinations/isolation.mjs';
import {
  spawnFile,
  spawnFileSync,
  captureCommandDiagnostics,
  safeDiagnosticText,
} from './process-files.mjs';

test('oracle command diagnostics retain stderr and missing program names without argv or environment', async () => {
  const fixture = freshEnvironment('command-diagnostic');
  try {
    const captured = await captureCommandDiagnostics(async () => {
      await spawnFile(
        process.execPath,
        [
          '-e',
          'process.stderr.write("ZEROHFAKE diagnostic\\nline two");process.exitCode=7',
        ],
        { env: fixture.env },
      );
      return spawnFile('ZEROHFAKEmissing-program', ['private-argument'], {
        env: fixture.env,
      });
    });
    assert.equal(captured.error.code, 'ENOENT');
    assert.equal(captured.commands[0].status, 7);
    assert.match(captured.commands[0].stderr, /ZEROHFAKE diagnostic\nline two/);
    assert.equal(captured.commands[1].program, 'ZEROHFAKEmissing-program');
    assert.equal(captured.commands[1].error, 'ENOENT');
    assert.equal(
      JSON.stringify(captured.commands).includes('private-argument'),
      false,
    );
    assert.equal(
      safeDiagnosticText('password=ZEROHFAKEvalue'),
      'password=[redacted]',
    );
    assert.equal(safeDiagnosticText('a\nb\nc\nd\ne\nf'), 'a\nb\nc\nd\ne');
    const unscoped = await captureCommandDiagnostics(() =>
      Promise.resolve('unused'),
    );
    assert.deepEqual(unscoped.commands, []);
  } finally {
    fixture.cleanup();
  }
});

test('isolated file transport preserves real stdin, stdout, stderr and exit status', async () => {
  const fixture = freshEnvironment('process-files-test');
  try {
    const script =
      "const fs=require('node:fs'); fs.writeSync(1,fs.readFileSync(0)); fs.writeSync(2,'diagnostic'); process.exitCode=3";
    for (const run of [spawnFileSync, spawnFile]) {
      const result = await run(process.execPath, ['-e', script], {
        input: 'ZEROHFAKE café\n"quoted"\n',
        env: fixture.env,
        timeout: 5000,
      });
      assert.equal(result.status, 3);
      assert.equal(result.stdout, 'ZEROHFAKE café\n"quoted"\n');
      assert.equal(result.stderr, 'diagnostic');
      assert.equal(result.error, undefined);
      assert.equal(
        readdirSync(fixture.root).some((name) =>
          name.startsWith('zeroh-process-'),
        ),
        false,
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test('ordinary subprocesses receive no bridge-only child deadline and fixture env stays unchanged', async () => {
  const fixture = freshEnvironment('process-files-deadline');
  try {
    for (const run of [spawnFileSync, spawnFile]) {
      const result = await run(
        process.execPath,
        [
          '-e',
          'process.stdout.write(process.env.ZEROH_ORACLE_CHILD_TIMEOUT_MS ?? "absent")',
        ],
        { env: fixture.env, timeout: 8000 },
      );
      assert.equal(result.status, 0);
      assert.equal(result.stdout, 'absent');
      assert.equal(fixture.env.ZEROH_ORACLE_CHILD_TIMEOUT_MS, undefined);
    }
  } finally {
    fixture.cleanup();
  }
});

test('file transport reports unavailable programs and requires isolated storage', async () => {
  assert.throws(() => spawnFileSync('missing', [], {}), /TMPDIR/);
  const fixture = freshEnvironment('process-files-error');
  try {
    const result = spawnFileSync('ZEROHFAKEmissing-program', [], {
      env: fixture.env,
    });
    assert.equal(result.error?.code, 'ENOENT');
    await assert.rejects(
      spawnFile('ZEROHFAKEmissing-program', [], { env: fixture.env }),
      { code: 'ENOENT' },
    );
    assert.equal(
      readdirSync(fixture.root).some((name) =>
        name.startsWith('zeroh-process-'),
      ),
      false,
    );
  } finally {
    fixture.cleanup();
  }
});

test('only the named bridge receives a reserved deadline through both file transports', async () => {
  const fixture = freshEnvironment('bridge-deadline');
  try {
    // A Node binary with the bridge name exposes its received environment,
    // independently of PowerShell availability and without shell wrappers.
    const bridge = path.join(fixture.bin, 'fixture-powershell.exe');
    if (process.platform === 'win32') copyFileSync(process.execPath, bridge);
    else symlinkSync(process.execPath, bridge);
    for (const run of [spawnFileSync, spawnFile]) {
      for (const [timeout, expected] of [
        [8000, '4000'],
        [60000, '50000'],
      ]) {
        const result = await run(
          bridge,
          [
            '-e',
            'process.stdout.write(process.env.ZEROH_ORACLE_CHILD_TIMEOUT_MS)',
          ],
          { env: fixture.env, timeout },
        );
        assert.equal(result.status, 0);
        assert.equal(result.stdout, expected);
      }
      assert.equal(fixture.env.ZEROH_ORACLE_CHILD_TIMEOUT_MS, undefined);
    }
  } finally {
    fixture.cleanup();
  }
});
