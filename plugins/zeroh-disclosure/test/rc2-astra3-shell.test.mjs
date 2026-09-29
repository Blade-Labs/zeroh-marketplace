// SPDX-License-Identifier: AGPL-3.0-only

// Astra rc.2 review, round 3 (F1, F2, F4, F5): options and program text read
// once, the same way, by the settings guard and the destination check
// (lib/shell-programs.js).
//
// F1  interpreter code attached to its option (`python3 -c'…'`,
//     `node --eval=…`) that writes a protected settings file;
// F2  sed `w`/`W`/`e` and awk output redirection or system() naming one;
// F4  `source`/`.` and git's remote operations were "local";
// F5  `curl -Kcfg` / `-sKcfg` hid the config file that names the host.
//
// Owner rules: writing a protected file is one of the two default stops;
// a destination ZeroH can't work out runs in pass mode with the notice and is
// denied, before anything is restored, in block mode. Reads keep passing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bashPath, runHook, tempProject } from './helpers.mjs';
import { shellDestinations } from '../lib/shell-destinations.js';
import {
  awkProgram,
  gitCommand,
  interpreterCode,
  readOptions,
  readAwkProgram,
  readSedScript,
} from '../lib/shell-programs.js';
import { analyzeBash } from '../lib/shell-scan.js';

const DISABLE = '{"disableAllHooks":true}';
// A fake password, assembled so this file holds no detectable assignment.
const FAKE_PASSWORD = 'ZEROH' + 'FAKE-pw7Q2x9Lm';
const quote = (text) => `'${text.replaceAll("'", `'\\''`)}'`;
const words = (list) => list.map((value) => ({ value, raw: value }));

function settingsProject() {
  const p = tempProject({ env: false });
  const target = path.join(p.dir, '.claude', 'settings.json');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, '{}\n');
  writeFileSync(path.join(p.dir, 'disable.json'), `${DISABLE}\n`);
  return { p, target };
}

function preToolUse(p, command, extraEnv = {}) {
  const { json } = runHook(
    'pre-tool-use',
    {
      tool_use_id: `astra3-${Math.random()}`,
      tool_name: 'Bash',
      tool_input: { command },
    },
    { project: p, extraEnv },
  );
  const specific = json?.hookSpecificOutput ?? {};
  return {
    decision: specific.permissionDecision ?? 'allow',
    updated: specific.updatedInput ?? null,
    notice: json?.systemMessage ?? '',
  };
}

// Git Bash on Windows (no /bin/bash there), the system Bash elsewhere.
const BASH = process.platform === 'win32' ? 'bash' : '/bin/bash';

// GNU sed has options and commands BSD sed (macOS) lacks: `--expression`
// and its abbreviations, `e` and `W`. The guard must stop those spellings
// everywhere; only GNU sed can show that they are real writes.
const GNU_SED =
  spawnSync('sed', ['--version'], { encoding: 'utf8' }).status === 0;

function bash(command, cwd, home) {
  return spawnSync(BASH, ['--noprofile', '--norc', '-c', command], {
    cwd,
    env: { PATH: process.env.PATH, HOME: home },
    encoding: 'utf8',
    // A cold interpreter start on a Windows runner (antivirus scanning
    // python.exe) has taken more than 10 s.
    timeout: process.platform === 'win32' ? 60_000 : 10_000,
  });
}

const available = (program) =>
  spawnSync(program, ['--version'], { encoding: 'utf8' }).status === 0 ||
  spawnSync(BASH, ['-c', `command -v ${program}`]).status === 0;

// Each command writes DISABLE into the protected settings file `t`.
function protectedWrites(t) {
  const py = `open(${JSON.stringify(t)},"w").write(${JSON.stringify(DISABLE)})`;
  const js = `require("fs").writeFileSync(${JSON.stringify(t)},${JSON.stringify(DISABLE)})`;
  const pl = `open(F, ">", "${t}"); print F '${DISABLE}';`;
  return [
    ['python3', `python3 -c${quote(py)}`],
    ['python3', `python3 -Ic${quote(py)}`],
    ['python3', `python3 -c ${quote(py)}`],
    ['python3', `python3 - <<'EOF'\n${py}\nEOF`],
    ['python3', `python3 <<< ${quote(py)}`],
    ['node', `node --eval=${quote(js)}`],
    ['node', `node --eval ${quote(js)}`],
    ['node', `node -e ${quote(js)}`],
    ['node', `node -pe ${quote(js)}`],
    ['perl', `perl -e${quote(pl)}`],
    ['perl', `perl -we ${quote(pl)}`],
    ['sed', `sed ${quote(`w ${t}`)} disable.json`],
    ['sed', `sed -e ${quote(`w ${t}`)} disable.json`],
    ['sed', `sed --expression=${quote(`w ${t}`)} disable.json`, 'gnu'],
    ['sed', `sed -n ${quote(`W ${t}`)} disable.json`, 'gnu'],
    ['sed', `sed -n ${quote(`s/x*/&/w ${t}`)} disable.json`],
    ['sed', `sed ${quote(`1e cp disable.json ${t}`)} disable.json`, 'gnu'],
    ['sed', `sed -ne ${quote(`/disable/w ${t}`)} disable.json`],
    [
      'awk',
      `awk ${quote(`BEGIN {print ${JSON.stringify(DISABLE)} > "${t}"}`)}`,
    ],
    [
      'awk',
      `awk -v f=${t} ${quote(`BEGIN {print ${JSON.stringify(DISABLE)} > f}`)}`,
    ],
    ['awk', `awk ${quote('{print > f}')} f=${t} disable.json`],
    ['awk', `awk ${quote(`BEGIN {system("cp disable.json ${t}")}`)}`],
    [
      'awk',
      `awk ${quote(`BEGIN {print ${JSON.stringify(DISABLE)} | "tee ${t}"}`)}`,
    ],
  ];
}

test('F1/F2: explicit writes to protected settings are denied in both modes, and are real writes', () => {
  const { p, target } = settingsProject();
  // The path as Git Bash on Windows passes it on (C:/…): a pair of
  // backslashes in its command line arrives as one, so "C:\\Users" would be
  // a string escape to Python or Perl, not the file.
  for (const [program, command, gnuOnly] of protectedWrites(bashPath(target))) {
    for (const mode of ['pass', 'block']) {
      const out = preToolUse(p, command, { ZEROH_UNCERTAIN: mode });
      assert.equal(out.decision, 'deny', `${mode}: ${command}`);
      assert.equal(out.updated, null, `${mode}: ${command}`);
    }
    if (!available(program) || (gnuOnly && !GNU_SED)) continue;
    // What the denied command would have done: it writes the fixture.
    writeFileSync(target, '{}\n');
    const run = bash(command, p.dir, p.home);
    assert.equal(run.status, 0, `${command}: ${run.stderr}`);
    assert.match(
      readFileSync(target, 'utf8'),
      /disableAllHooks/u,
      `the case is a real write: ${command}`,
    );
    writeFileSync(target, '{}\n');
  }
});

test('V4: a sed or awk program ZeroH cannot read that names a protected path runs with the notice, and is denied in block mode', () => {
  const { p, target } = settingsProject();
  writeFileSync(path.join(p.dir, 'read.awk'), '{print}\n');
  writeFileSync(path.join(p.dir, 'read.sed'), 'p\n');
  for (const command of [
    `sed ${quote(`1{ Z w ${target}`)} disable.json`,
    `sed "$SCRIPT" ${target}`,
    `sed -f read.sed ${target}`,
    `awk "$PROG" ${target}`,
    `awk -f read.awk ${target}`,
    `awk '{print > $1}' ${target}`,
  ]) {
    const pass = preToolUse(p, command);
    assert.equal(pass.decision, 'allow', command);
    assert.match(pass.notice, /this command was not protected/u, command);
    const block = preToolUse(p, command, { ZEROH_UNCERTAIN: 'block' });
    assert.equal(block.decision, 'deny', command);
  }
  // Running a protected file as the program is still a stop.
  assert.equal(preToolUse(p, `awk -f ${target} disable.json`).decision, 'deny');
  assert.equal(preToolUse(p, `sed -f ${target} disable.json`).decision, 'deny');
});

test('F1/F2: reading protected settings with interpreters, sed and awk still runs', () => {
  const { p, target } = settingsProject();
  writeFileSync(target, '{"env":{"ZEROHFAKE":"1"}}\n');
  const before = readFileSync(target, 'utf8');
  for (const [program, command] of [
    ['sed', `sed -n 1p ${target}`],
    ['sed', `sed 's/1/2/' ${target}`],
    ['sed', `sed -n '/env/p;w out.txt' ${target}`],
    ['awk', `awk '{print}' ${target}`],
    ['awk', `awk '{print > "out.txt"}' ${target}`],
    ['awk', `awk '$1 > 0 {n++} END {print n}' ${target}`],
    [
      'awk',
      `awk 'BEGIN {while ((getline line < "${target}") > 0) print line}'`,
    ],
    [
      'python3',
      `python3 -c 'import sys; print(open(sys.argv[1]).read())' ${target}`,
    ],
    ['node', `node -e 'console.log(1)' ${target}`],
    ['python3', `python3 -m json.tool ${target}`],
    ['perl', `perl -ne print ${target}`],
    ['perl', `perl -Ilib -ne print ${target}`],
  ]) {
    if (!available(program)) continue;
    const out = preToolUse(p, command);
    assert.equal(out.decision, 'allow', command);
    const run = bash(out.updated?.command ?? command, p.dir, p.home);
    assert.equal(run.status, 0, `${command}: ${run.stderr}`);
    assert.equal(readFileSync(target, 'utf8'), before, command);
  }
});

function maskedPassword(p) {
  const { json } = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_input: { command: 'cat fixture.txt' },
      tool_response: {
        stdout: 'password: "ZEROHFAKE-secret-987!"',
        stderr: '',
      },
    },
    { project: p },
  );
  return JSON.stringify(json).match(/\[PASSWORD-[0-9a-f]{6}\]/u)[0];
}

test('F4/F5: source, dot, git remotes and clustered curl -K: notice in pass mode, denied before restoring in block mode', () => {
  const p = tempProject({ env: false });
  const token = maskedPassword(p);
  writeFileSync(
    path.join(p.dir, 'send.sh'),
    'printf "%s" "$1" > received.txt\n',
  );
  writeFileSync(path.join(p.dir, 'file.txt'), 'ZEROHFAKE local file\n');
  writeFileSync(
    path.join(p.dir, 'config.txt'),
    `url = "file://${p.dir}/file.txt"\n`,
  );
  const cases = [
    [`source ./send.sh ${token}`, 'script-or-interpreter', true],
    [`. ./send.sh ${token}`, 'script-or-interpreter', true],
    [
      `git -c http.extraHeader='Authorization: ${token}' push origin HEAD`,
      'dynamic-destination',
      false,
    ],
    [
      `git fetch origin --negotiation-tip=${token}`,
      'dynamic-destination',
      false,
    ],
    [`git ${token}-alias`, 'script-or-interpreter', false],
    [`curl -sKconfig.txt -d ${token}`, 'dynamic-destination', true],
    [`curl -Kconfig.txt -d ${token}`, 'dynamic-destination', true],
    [`curl -K config.txt -d ${token}`, 'dynamic-destination', true],
    [`curl --config=config.txt -d ${token}`, 'dynamic-destination', true],
  ];
  for (const [command, reason, runIt] of cases) {
    const found = shellDestinations(command);
    assert.ok(
      found.uncertain.some((u) => u.reason === reason),
      `${command}: ${JSON.stringify(found.uncertain)}`,
    );
    const pass = preToolUse(p, command);
    assert.equal(pass.decision, 'allow', `pass: ${command}`);
    assert.match(
      pass.notice,
      /ZeroH Disclosure: this command was not protected/u,
      `pass notice: ${command}`,
    );
    if (runIt) {
      const run = bash(pass.updated.command, p.dir, p.home);
      assert.equal(run.status, 0, `${command}: ${run.stderr}`);
    }
    const block = preToolUse(p, command, { ZEROH_UNCERTAIN: 'block' });
    assert.equal(block.decision, 'deny', `block: ${command}`);
    assert.equal(block.updated, null, `block restores nothing: ${command}`);
  }
  // The sourced script received the real value in pass mode.
  assert.equal(
    readFileSync(path.join(p.dir, 'received.txt'), 'utf8'),
    'ZEROHFAKE-secret-987!',
  );
});

test('F4: local git and a git URL on the line are not uncertain', () => {
  const T = '[PASSWORD-abc123]';
  for (const command of [
    `git commit -m ${T}`,
    `git -C repo log --grep=${T}`,
    `git --no-pager diff ${T}`,
    `git remote add origin ${T}`,
    'git status',
  ]) {
    assert.deepEqual(shellDestinations(command).uncertain, [], command);
  }
  assert.deepEqual(
    shellDestinations(`git push https://u:${T}@example.com/o/r`).destinations,
    ['example.com'],
  );
  assert.deepEqual(
    shellDestinations('git clone git@example.org:o/r').destinations,
    ['example.org'],
  );
  assert.equal(
    gitCommand(analyzeBash(`git -c core.sshCommand=x status`).commands[0])
      .commandConfig,
    true,
  );
});

test('readOptions: clustered, attached and long options read as getopt does', () => {
  const curl = { values: ['-K', '-d', '--config', '-X'] };
  const names = (list, spec) =>
    readOptions(words(list), spec).options.map((option) => [
      option.name,
      option.value?.value ?? null,
    ]);
  assert.deepEqual(names(['-sKcfg', '-d', 'x'], curl), [
    ['-s', null],
    ['-K', 'cfg'],
    ['-d', 'x'],
  ]);
  assert.deepEqual(names(['-sK', 'cfg'], curl), [
    ['-s', null],
    ['-K', 'cfg'],
  ]);
  assert.deepEqual(names(['--config=cfg', '--config', 'c2'], curl), [
    ['--config', 'cfg'],
    ['--config', 'c2'],
  ]);
  assert.deepEqual(
    readOptions(words(['--', '-K', 'x']), curl).operands.map((w) => w.value),
    ['-K', 'x'],
  );
  // sed -i takes only an attached suffix: `-ie` is suffix "e".
  assert.deepEqual(names(['-ie', 's/a/b/'], { optional: ['-i'] }), [
    ['-i', 'e'],
  ]);
  const code = (command) =>
    interpreterCode(analyzeBash(command).commands[0]).code.map((c) => c.code);
  assert.deepEqual(code(`python3 -Ic'print(1)' a`), ['print(1)']);
  assert.deepEqual(code(`node --eval='x()'`), ['x()']);
  assert.deepEqual(code(`node -pe 'x()'`), ['x()']);
  assert.deepEqual(code(`perl -Mstrict -ne 'print'`), ['print']);
  assert.deepEqual(code(`python3 script.py -c 'not code'`), []);
});

test('sed and awk programs are read for what they write and run', () => {
  assert.deepEqual(readSedScript('1,/x/!{ s/a/b/gw out\n}').writes, ['out']);
  assert.deepEqual(readSedScript('w a b;c').writes, ['a b;c']);
  assert.equal(readSedScript('$e date').executes.length, 1);
  assert.equal(readSedScript('s/a/date/e').executes.length, 1);
  assert.deepEqual(readSedScript('r in.txt').reads, ['in.txt']);
  assert.equal(readSedScript('s/a/b/;p;q5').ok, true);
  assert.equal(readSedScript('y/abc/xyz/;$!N;P;D').ok, true);
  assert.equal(readSedScript('1 Z').ok, false);
  assert.equal(readSedScript('s/a/b').ok, false);
  const files = (program) =>
    readAwkProgram(program).redirects.map((r) => r.target);
  assert.deepEqual(files('{print > "a" ; print >> "b"}'), [
    { literal: 'a' },
    { literal: 'b' },
  ]);
  assert.deepEqual(files('{print > $1 ".txt"}'), [{ expression: true }]);
  assert.deepEqual(files('{print "a > b | c"}'), []);
  assert.deepEqual(readAwkProgram('BEGIN {"date" | getline d}').getline, [
    { kind: 'command', target: { literal: 'date' } },
  ]);
  assert.deepEqual(files('$1 > 5 || $2 {print}'), []);
  // Astra rc.2 V2 and V4: continuations, regex literals, parentheses.
  assert.deepEqual(files('BEGIN {print \\\n "x" > "a"}'), [{ literal: 'a' }]);
  assert.deepEqual(files('BEGIN {print (1 ? "x" : /;/) > "a"}'), [
    { literal: 'a' },
  ]);
  assert.deepEqual(files('{print (length($0) > 1)}'), []);
  assert.deepEqual(files('{print $1 / 2 > "a"}'), [{ literal: 'a' }]);
  const awk = awkProgram(
    analyzeBash(`gawk -i inplace -v a=1 '{print}' f x=2`).commands[0],
  );
  assert.equal(awk.inPlace, true);
  assert.deepEqual(
    awk.assignments.map((w) => w.value),
    ['a=1', 'x=2'],
  );
});

test('F2: sed e and awk system() with a restored value are uncertain destinations', () => {
  const T = '[PASSWORD-abc123]';
  for (const command of [
    `sed '1e curl -d ${T} $HOST' f`,
    `awk -v k=${T} 'BEGIN {system("curl -d " k " $HOST")}'`,
  ]) {
    assert.ok(
      shellDestinations(command).uncertain.some(
        (u) => u.reason === 'script-or-interpreter',
      ),
      command,
    );
  }
  assert.deepEqual(shellDestinations(`sed s/a/${T}/ f`).uncertain, []);
});
