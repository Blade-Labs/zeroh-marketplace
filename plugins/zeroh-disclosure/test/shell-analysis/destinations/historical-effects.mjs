// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { windowsFixtureTool } from './windows-tools.mjs';
import path from 'node:path';
import {
  spawnFile,
  captureCommandDiagnostics,
  safeDiagnosticText,
} from '../parsers/process-files.mjs';
import { generateCorpus, TOKEN, VALUE } from './corpus.mjs';
import { writeCaseFixtures } from './differential.mjs';
import {
  freshEnvironment,
  shellArguments,
  shellKind,
  shellExecutable,
} from './isolation.mjs';

// Git Bash process start-up on hosted Windows runners can exceed 10 s.
const HISTORICAL_TIMEOUT_MS = process.platform === 'win32' ? 30000 : 10000;

export async function historicalEffects({
  shells = ['bash', 'zsh'],
  executables = {},
} = {}) {
  const diagnostics = [];
  const results = [],
    failures = [];
  const selected = new Set([
    'source-data',
    'dot-data',
    'git-named-custom-transport',
    'gh-extension-execution',
    'tar-protected-extraction',
    'rg-protected-quoted-option',
    'rg-protected-escaped-option',
    'sed-write-expression',
    'sed-abbreviated-expression',
    'perl-optional-numeric-code',
    'awk-continued-write',
    'awk-regex-semicolon-write',
    'python-literal-path-read',
    'perl-literal-path-read',
    'awk-literal-path-read',
  ]);
  for (const shell of shells)
    for (const row of generateCorpus().filter(
      (r) =>
        r.shell === shellKind(shell) &&
        r.category === 'historical-adversarial' &&
        selected.has(r.spelling),
    )) {
      const fixture = freshEnvironment('historical-effect');
      const commands = [];
      const run = async (program, args, extra = {}) => {
        const captured = await captureCommandDiagnostics(() =>
          spawnFile(program, args, {
            env: { ...fixture.env, ...extra },
            cwd: fixture.root,
            timeout: HISTORICAL_TIMEOUT_MS,
          }),
        );
        commands.push(...captured.commands);
        if (captured.error) throw captured.error;
        return captured.result;
      };
      try {
        writeCaseFixtures(fixture.root, row.fixtures);
        let command = row.command.replaceAll(TOKEN, row.restoredValue ?? VALUE);
        if (
          process.platform === 'win32' &&
          row.spelling.startsWith('rg-protected-')
        ) {
          // Native Windows rg launches PE executables, not POSIX shebang files.
          copyFileSync(
            windowsFixtureTool('pre'),
            path.join(fixture.root, 'pre.exe'),
          );
          // rg 14's Windows resolver searches PATH even for ./relative paths.
          // An absolute native path bypasses that search; MSYS conversion is off.
          command = command.replace(
            './pre.sh',
            path.join(fixture.root, 'pre.exe').replaceAll('\\', '/'),
          );
        }
        const settings = path.join(fixture.root, '.claude/settings.json');
        if (row.expected.effect === 'protection' && existsSync(settings))
          writeFileSync(settings, 'ZEROHFAKEbefore\n');
        const before = existsSync(settings) ? readFileSync(settings) : null;
        if (row.spelling === 'gh-extension-execution') {
          const ext = path.join(
            fixture.env.HOME,
            '.local/share/gh/extensions/gh-probe',
          );
          mkdirSync(ext, { recursive: true });
          writeFileSync(
            path.join(ext, 'gh-probe'),
            '#!/bin/sh\nprintf "%s" "$*" >effect.txt\n',
            { mode: 0o700 },
          );
        }
        if (row.spelling === 'git-named-custom-transport') {
          // Use a real Git repository; a fabricated .git/config is not a repository.
          await run('git', ['init', '--quiet']);
        }
        const result = await run(
          shellExecutable(shell, executables),
          shellArguments(shell, command),
          {
            GH_TOKEN: 'ZEROHFAKEauth',
            GH_NO_UPDATE_NOTIFIER: '1',
            GH_PROMPT_DISABLED: '1',
          },
        );
        assert.ok(
          Number.isInteger(result.status) && result.signal === null,
          'historical command must terminate normally',
        );
        if (row.expected.effect === 'protection') {
          assert.ok(before, 'protected fixture absent');
          assert.notDeepEqual(
            readFileSync(settings),
            before,
            'protected write absent',
          );
        } else if (row.expected.effect === 'code') {
          assert.ok(
            existsSync(path.join(fixture.root, 'effect.txt')),
            'executed code receipt missing',
          );
          const output = readFileSync(
            path.join(fixture.root, 'effect.txt'),
            'utf8',
          );
          assert.ok(
            output.includes(VALUE),
            'value not delivered to executed code',
          );
          if (row.program === 'git')
            assert.ok(
              output.includes('git.example.com'),
              'Git custom transport host missing',
            );
        } else {
          assert.equal(result.status, 0, 'local read failed');
          assert.equal(result.stdout.trim(), '{}', 'literal local read result');
          assert.deepEqual(readFileSync(settings), before);
        }
        results.push({
          id: row.id,
          shell,
          program: row.program,
          effect: row.expected.effect,
          status: 'passed',
          exitStatus: result.status,
        });
      } catch (error) {
        diagnostics.push({
          oracle: 'historical',
          shell,
          caseIds: [row.id],
          message: safeDiagnosticText(error.message),
          commands,
        });
        results.push({
          id: row.id,
          shell,
          program: row.program,
          status: 'failed',
        });
        failures.push(`${row.id}: historical execution effect failed`);
      } finally {
        fixture.cleanup();
      }
    }
  // An ext transport is an independently executed local program, not a host parsed from argv.
  for (const shell of shells) {
    const f = freshEnvironment('git-ext');
    try {
      writeFileSync(
        path.join(f.root, 'transport.sh'),
        '#!/bin/sh\nprintf "%s" "$*" >effect.txt\nexit 1\n',
        { mode: 0o700 },
      );
      const r = await spawnFile(
        shellExecutable(shell, executables),
        shellArguments(
          shell,
          `git -c protocol.ext.allow=always ls-remote "ext::./transport.sh ${VALUE}"`,
        ),
        { env: f.env, cwd: f.root, timeout: HISTORICAL_TIMEOUT_MS },
      );
      assert.equal(
        readFileSync(path.join(f.root, 'effect.txt'), 'utf8'),
        VALUE,
      );
      assert.ok(
        Number.isInteger(r.status) && r.status !== 0 && r.signal === null,
        'custom transport failure must terminate normally',
      );
      results.push({
        id: 'git-ext-' + shell,
        shell,
        program: 'git',
        effect: 'code',
        status: 'passed',
        exitStatus: r.status,
      });
    } catch {
      failures.push(`git-ext-${shell}: custom transport effect failed`);
    } finally {
      f.cleanup();
    }
  }
  return {
    results,
    failures,
    diagnostics,
    pending: results.filter((r) => r.status !== 'passed').map((r) => r.id),
  };
}
