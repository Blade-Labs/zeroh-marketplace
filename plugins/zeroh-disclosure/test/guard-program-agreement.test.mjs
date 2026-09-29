// SPDX-License-Identifier: AGPL-3.0-only

// The settings guard and the destination check read a program's arguments
// with the same readers (lib/shell-programs.js: gitCommand,
// localProgramReach), so an option means the same thing to both however it
// is spelled (architect review 1.0.0). Before, the guard had if-chains of its
// own: `git -C /tmp rm <settings>` read `/tmp` as git's subcommand and passed
// silently, and `tar --to-command=sh`, `sort --compress-program=sh` against a
// protected file passed while the destination check said "runs a program".
//
// For every command of the corpus below (each names Claude Code's
// settings.json), the guard stops it exactly when the shared reader says it
// runs a program or git writes, and the destination check agrees on whether
// a program runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { protectedShellDecision } from '../lib/settings-guard.js';
import { analyzeBash } from '../lib/shell-scan.js';
import {
  gitCommand,
  GIT_WRITE_SUBCOMMANDS,
  localProgramReach,
  optionWrites,
  optionWritesInto,
  RUNNER_OPTIONS,
} from '../lib/shell-programs.js';
import { shellDestinations } from '../lib/shell-destinations.js';
import { bashPath, runHook, tempProject } from './helpers.mjs';

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-agreement-'));
  const home = path.join(directory, 'home');
  const plugin = path.join(directory, 'installed-plugin');
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  mkdirSync(path.join(plugin, 'hooks'), { recursive: true });
  const settings = path.join(home, '.claude', 'settings.json');
  writeFileSync(settings, '{}\n');
  return {
    directory,
    settings,
    options: { env: { HOME: home }, pluginDir: plugin },
  };
}

const f = fixture();
// As a Bash command spells the path (Git Bash on Windows: C:/Users/…).
const S = bashPath(f.settings);

// A program option that runs another program, against the protected file.
const RUNS = [
  `rg --pre sh ZEROHFAKE ${S}`,
  `rg --pre=sh ZEROHFAKE ${S}`,
  `rg --hostname-bin=sh ZEROHFAKE ${S}`,
  `tar -xf a.tar --to-command=sh ${S}`,
  `tar xf a.tar --to-command sh ${S}`,
  `tar -I sh -cf out.tar ${S}`,
  `tar --use-compress-prog=sh -cf out.tar ${S}`,
  `tar --checkpoint-action=exec=sh -cf out.tar ${S}`,
  `sort --compress-program=sh ${S}`,
  `sort --compress-prog=sh ${S}`,
  `sort --compress-program sh ${S}`,
  `zip -TT sh a.zip ${S}`,
  `zip --unzip-command sh a.zip ${S}`,
  `less +!sh ${S}`,
  `more +!sh ${S}`,
];

// The same programs reading the protected file, nothing run or written.
// `rg -e --pre` searches for the text "--pre": -e takes a value.
const READS = [
  `rg ZEROHFAKE ${S}`,
  `rg -e --pre ${S}`,
  `rg --regexp=--pre ${S}`,
  `sort ${S}`,
  `sort -k 2 ${S}`,
  `tar -tf a.tar ${S}`,
  `less ${S}`,
  `more ${S}`,
];

// Options that write their value: a write to the protected file.
const WRITES = [`sort -o ${S} other.txt`, `sort --output=${S} other.txt`];

// Archive extraction (Astra pre-1.0.0 R1): `tar -xf a.tar -C ~/.claude
// settings.json` replaced Claude Code's settings with no stop and no notice.
// A named member is resolved against the extractor's directory (-C,
// --directory, unzip -d, 7z -o; the working directory without one).
const D = bashPath(path.dirname(f.settings));
const EXTRACT_WRITES = [
  `tar -xf a.tar -C ${D} settings.json`,
  `tar -xf a.tar --directory ${D} settings.json`,
  `tar -xf a.tar --directory=${D} settings.json`,
  `tar -xf a.tar --dir=${D} settings.json`,
  `tar xf a.tar -C ${D} ./settings.json`,
  `tar -x -f a.tar -C${D} settings.json`,
  `tar --extract --file=a.tar -C ${D} settings.json`,
  `tar -xvzf a.tgz -C ${D}/ settings.json`,
  `tar -xf a.tar home/.claude/settings.json`,
  `tar -xPf a.tar ${S}`,
  `unzip a.zip settings.json -d ${D}`,
  `unzip -o a.zip -d ${D} settings.json`,
  `unzip -o -d${D} a.zip settings.json`,
  `unzip -P ZEROHFAKE a.zip settings.json -d ${D}`,
  `7z x a.7z -o${D} settings.json`,
];

// Extraction into a protected folder of files ZeroH can't name: every
// member, a pattern, a list from a file, renamed paths. Uncertain: it runs
// with the notice in pass mode, block mode stops it.
const EXTRACT_INTO = [
  `tar -xf a.tar -C ${D}`,
  `tar -xzf a.tgz --directory=${D}`,
  `tar -xf a.tar -C ${D} --wildcards '*.json'`,
  `tar -xf a.tar -C ${D} -T list.txt`,
  `tar -xf a.tar -C ${D} --strip-components=1 x/settings.json`,
  `unzip a.zip -d ${D}`,
  `unzip -o a.zip -d${D}`,
  `unzip -j a.zip x/settings.json -d ${D}`,
  `cpio -idm -D ${D}`,
  `cpio -i --directory=${D}`,
  `7z x a.7z -o${D}`,
  `7z e a.7z -o${D} settings.json`,
];

// Listing, extracting to standard output, or a named member that is not
// protected: nothing protected is written.
const EXTRACT_NOTHING = [
  `tar -tf a.tar -C ${D}`,
  `tar -xOf a.tar -C ${D} settings.json`,
  `tar -xf a.tar --to-stdout -C ${D} settings.json`,
  `tar -xf a.tar -C ${D} notes.txt`,
  `unzip -l a.zip -d ${D}`,
  `unzip -p a.zip settings.json -d ${D}`,
  `unzip a.zip notes.txt -d ${D}`,
  'tar -xf a.tar',
  'tar -xzf a.tgz -C vendor',
  'unzip a.zip',
  'unzip -o a.zip -d build',
  'cpio -idm',
  '7z x a.7z -oout',
];

// git with its global options before a subcommand that changes files.
const GIT = [
  [`git rm ${S}`, true],
  [`git -C /tmp rm ${S}`, true],
  [`git -C/tmp rm ${S}`, true],
  [`git --git-dir=/x rm ${S}`, true],
  [`git --git-dir /x --work-tree /w rm ${S}`, true],
  [`git -c core.quotepath=off rm ${S}`, true],
  [`git -C /tmp checkout -- ${S}`, true],
  [`git -C /tmp restore ${S}`, true],
  [`git -C /tmp mv ${S} elsewhere.json`, true],
  [`git -C /tmp log ${S}`, false],
  [`git -C /tmp diff ${S}`, false],
  [`git --no-pager -C /tmp blame ${S}`, false],
];

function entryOf(command) {
  const analysis = analyzeBash(command);
  assert.ok(analysis.ok, command);
  assert.equal(analysis.commands.length, 1, command);
  return analysis.commands[0];
}

function guard(command) {
  return protectedShellDecision('Bash', { command }, f.directory, {
    ...f.options,
    mode: 'pass',
  });
}

function destinationRuns(command) {
  return shellDestinations(command).uncertain.some(
    (item) => item.reason === 'script-or-interpreter',
  );
}

test('every runner program in the shared table is in the corpus', () => {
  for (const program of Object.keys(RUNNER_OPTIONS)) {
    assert.ok(
      RUNS.some((command) => command.startsWith(`${program} `)),
      program,
    );
  }
});

test('a program option that runs a program against a protected file: the guard stops it, as the readers say', () => {
  for (const command of RUNS) {
    const reach = localProgramReach(entryOf(command));
    assert.ok(reach.runs, `reader: ${command}`);
    assert.equal(destinationRuns(command), true, `destination: ${command}`);
    const decision = guard(command);
    assert.equal(decision.deny, true, `guard: ${command}`);
  }
});

test('the same programs reading a protected file: nothing runs, the guard lets it read', () => {
  for (const command of READS) {
    const reach = localProgramReach(entryOf(command));
    assert.equal(reach.runs, null, `reader: ${command}`);
    assert.equal(destinationRuns(command), false, `destination: ${command}`);
    const decision = guard(command);
    assert.equal(decision.deny, false, `guard: ${command}`);
    assert.equal(decision.unchecked, null, `guard: ${command}`);
  }
});

test('an option that writes the protected file is a write, as the reader says', () => {
  for (const command of WRITES) {
    const written = optionWrites(entryOf(command)).map((word) => word.value);
    assert.deepEqual(written, [S], command);
    assert.equal(guard(command).deny, true, command);
  }
});

test('git: the guard reads the subcommand after the global options, as the destination check does', () => {
  for (const [command, writes] of GIT) {
    const git = gitCommand(entryOf(command));
    assert.equal(
      GIT_WRITE_SUBCOMMANDS.has(git.subcommand),
      writes,
      `reader: ${command} (${git.subcommand})`,
    );
    assert.equal(guard(command).deny, writes, `guard: ${command}`);
  }
});

test('archive extraction of a named protected member: the reader resolves it against the directory, the guard stops it (Astra pre-1.0.0 R1)', () => {
  for (const command of EXTRACT_WRITES) {
    const written = optionWrites(entryOf(command)).map((word) =>
      path.resolve(f.directory, word.value),
    );
    assert.ok(
      written.includes(path.resolve(f.settings)),
      `reader: ${command} -> ${JSON.stringify(written)}`,
    );
    for (const mode of ['pass', 'block']) {
      const decision = protectedShellDecision(
        'Bash',
        { command },
        f.directory,
        {
          ...f.options,
          mode,
        },
      );
      assert.equal(decision.deny, true, `guard (${mode}): ${command}`);
    }
  }
  // The folder as a model would spell it.
  for (const command of [
    'tar -xf a.tar -C ~/.claude settings.json',
    'tar -xf a.tar -C "$HOME/.claude" settings.json',
    'tar -xf a.tar -C "$CLAUDE_CONFIG_DIR" settings.json',
    'tar -xf a.tar -C ~ .claude/settings.json',
  ])
    assert.equal(guard(command).deny, true, `guard: ${command}`);
});

test('archive extraction into a protected folder of members ZeroH cannot name: uncertain, with the notice (Astra pre-1.0.0 R1)', () => {
  for (const command of EXTRACT_INTO) {
    const entry = entryOf(command);
    const into = optionWritesInto(entry).map((word) =>
      path.resolve(f.directory, word.value),
    );
    assert.ok(
      into.includes(path.resolve(path.dirname(f.settings))),
      `reader: ${command} -> ${JSON.stringify(into)}`,
    );
    const decision = guard(command);
    assert.equal(decision.deny, false, `guard: ${command}`);
    assert.equal(
      decision.unchecked,
      'script-or-interpreter',
      `guard notice: ${command}`,
    );
    const block = protectedShellDecision('Bash', { command }, f.directory, {
      ...f.options,
      mode: 'block',
    });
    assert.equal(block.deny, true, `guard (block): ${command}`);
  }
});

test('listing an archive, extracting to stdout or an unprotected member: no stop, no notice', () => {
  for (const command of EXTRACT_NOTHING) {
    const entry = entryOf(command);
    assert.equal(
      optionWrites(entry).some(
        (word) =>
          path.resolve(f.directory, word.value) === path.resolve(f.settings),
      ),
      false,
      `reader: ${command}`,
    );
    const decision = guard(command);
    assert.equal(decision.deny, false, `guard: ${command}`);
    assert.equal(decision.unchecked, null, `guard: ${command}`);
  }
});

const TAR = spawnSync('tar', ['--version'], { encoding: 'utf8' });
test(
  'actual extraction: tar writes exactly the file the reader names, and the real PreToolUse hook denies it (Astra pre-1.0.0 R1)',
  { skip: TAR.status !== 0 && 'no tar on PATH' },
  () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-extract-'));
    const staging = path.join(directory, 'staging');
    const home = path.join(directory, 'home');
    const config = path.join(home, '.claude');
    const settings = path.join(config, 'settings.json');
    mkdirSync(staging, { recursive: true });
    mkdirSync(config, { recursive: true });
    writeFileSync(
      path.join(staging, 'settings.json'),
      '{"disableAllHooks":true}\n',
    );
    const made = spawnSync(
      'tar',
      ['-cf', 'settings.tar', '-C', 'staging', 'settings.json'],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.equal(made.status, 0, made.stderr);
    const command = `tar -xf settings.tar -C ${bashPath(config)} settings.json`;

    // The reader's path is the file tar writes.
    const written = optionWrites(entryOf(command)).map((word) =>
      path.resolve(directory, word.value),
    );
    assert.deepEqual(written, [path.resolve(settings)]);
    writeFileSync(settings, '{}\n');
    const ran = spawnSync(
      'tar',
      ['-xf', 'settings.tar', '-C', config, 'settings.json'],
      {
        cwd: directory,
        encoding: 'utf8',
      },
    );
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(readFileSync(settings, 'utf8'), '{"disableAllHooks":true}\n');

    // The real hook stops it before it runs.
    writeFileSync(settings, '{}\n');
    const p = tempProject();
    const { json } = runHook(
      'pre-tool-use',
      { tool_name: 'Bash', tool_input: { command } },
      {
        project: p,
        extraEnv: { HOME: home, CLAUDE_CONFIG_DIR: config },
      },
    );
    assert.equal(json?.hookSpecificOutput?.permissionDecision, 'deny', command);
    assert.ok(!('updatedInput' in json.hookSpecificOutput), command);
    assert.equal(readFileSync(settings, 'utf8'), '{}\n');
  },
);
