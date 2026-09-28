// SPDX-License-Identifier: AGPL-3.0-only

// rc.2 item 2: the one Bash tokenizer the settings guard and the destination
// check share (lib/shell-scan.js). Its argv is compared with what real Bash
// passes to a program, over a generated corpus of quoting, escape and
// launcher spellings (the oracle), so `--p"re"`, `--p\re`, `$'--pre'` and
// `"--"pre` are all the one word `--pre` here exactly as they are to ripgrep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analyzeBash,
  parseBash,
  parsePowerShell,
  unwrapCommand,
} from '../lib/shell-scan.js';

const BASH = process.platform === 'win32' ? null : '/bin/bash';
const skip = !BASH || spawnSync(BASH, ['-c', 'true']).status !== 0;
const EMPTY_DIR = mkdtempSync(path.join(os.tmpdir(), 'zeroh-oracle-'));
const ORACLE_ENV = {
  PATH: process.env.PATH,
  LC_ALL: 'C.UTF-8',
  HOME: EMPTY_DIR,
};

// What Bash hands to printf for `printf '%s\0' <words>`.
function bashArgv(words) {
  const result = spawnSync(
    BASH,
    ['--noprofile', '--norc', '-c', `printf '%s\\0' ${words}`],
    {
      cwd: EMPTY_DIR,
      env: ORACLE_ENV,
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) return null;
  const out = result.stdout;
  return out ? out.slice(0, -1).split('\0') : [];
}

function tokenizerArgv(words) {
  const parsed = parseBash(`printf '%s\\0' ${words}`);
  if (!parsed.ok) return null;
  assert.equal(parsed.commands.length, 1, words);
  return parsed.commands[0].words.slice(2).map((word) => word.value);
}

// Static fragments: every quoting and escape form Bash has, none that expands
// at run time (no `$VAR`, no leading `~`, no glob that could match).
const FRAGMENTS = [
  'abc',
  '--pre',
  '--p',
  're',
  '-x',
  "'s q'",
  "'--p'",
  '"d q"',
  '"a\\"b"',
  '"a\\\\b"',
  '"a\\$b"',
  '"a\\x"',
  '"a\\`b"',
  '\\ ',
  '\\"',
  "\\'",
  '\\\\',
  '\\n',
  '\\p',
  "$'a\\nb'",
  "$'\\x41\\101\\u00e9'",
  "$'it\\'s'",
  "$'\\t\\e\\a'",
  "$'a\\0b'",
  "$'\\cA'",
  '$"loc"',
  '"--"',
  "''",
  '""',
  '"$"',
  '\\$HOME',
  "'$HOME'",
  '=',
  'a=b',
  '\\\nx',
  'é',
  'a#b',
  '\\$(x)',
  "'\\\\'",
  '"\\\n"',
  '[x]',
  '{a}',
  '@',
  '%',
  ',',
  ':',
];

function* corpus(count) {
  // A fixed linear congruential sequence, so the corpus is the same each run.
  let seed = 20260927;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  for (const fragment of FRAGMENTS) yield fragment;
  for (let n = 0; n < count; n += 1) {
    const words = [];
    const wordCount = 1 + (next() % 4);
    for (let w = 0; w < wordCount; w += 1) {
      let word = '';
      const parts = 1 + (next() % 4);
      for (let p = 0; p < parts; p += 1)
        word += FRAGMENTS[next() % FRAGMENTS.length];
      words.push(word);
    }
    yield words.join(next() % 5 === 0 ? '\t' : ' ');
  }
}

test(
  'oracle: the tokenizer splits and unquotes words exactly as Bash does',
  { skip },
  (t) => {
    let compared = 0;
    let rejectedByBoth = 0;
    for (const words of corpus(700)) {
      const expected = bashArgv(words);
      const actual = tokenizerArgv(words);
      if (expected === null) {
        // Bash refused it (a syntax error): the tokenizer must not accept it
        // with a different reading.
        if (actual !== null)
          assert.fail(
            `bash rejected, tokenizer read: ${JSON.stringify(words)}`,
          );
        rejectedByBoth += 1;
        continue;
      }
      assert.deepEqual(actual, expected, JSON.stringify(words));
      compared += 1;
    }
    t.diagnostic(
      `oracle compared ${compared} command lines; ${rejectedByBoth} rejected by both`,
    );
    assert.ok(compared >= 700);
  },
);

test(
  'oracle: the rg execution option in every spelling is the word --pre',
  { skip },
  () => {
    for (const spelling of [
      '--p"re"',
      '--p\\re',
      "$'--pre'",
      '"--"pre',
      "'--'p're'",
      '--\\p\\r\\e',
      '$"--pre"',
    ]) {
      assert.deepEqual(bashArgv(spelling), ['--pre'], spelling);
      assert.deepEqual(tokenizerArgv(spelling), ['--pre'], spelling);
    }
  },
);

// Launchers: a stub program on PATH prints its own name and argv, so Bash and
// the real launchers show which program runs with which arguments.
test(
  'oracle: launcher unwrapping names the program real launchers run',
  { skip },
  (t) => {
    const bin = mkdtempSync(path.join(os.tmpdir(), 'zeroh-oracle-bin-'));
    for (const name of ['zstub', 'zother']) {
      const file = path.join(bin, name);
      writeFileSync(file, `#!/bin/sh\nprintf '%s\\0' "${name}" "$@"\n`);
      chmodSync(file, 0o755);
    }
    const cases = [
      'zstub a b',
      `${bin}/zstub a`,
      'env zstub a',
      `env -i ${bin}/zstub a`,
      'env -u UNUSED zstub a',
      'env -uUNUSED zstub a',
      'env --unset=UNUSED zstub a',
      'env A=1 B=2 zstub a',
      `env -i -- A=1 ${bin}/zstub a`,
      'env -C / zstub a',
      `/usr/bin/env zstub a`,
      'timeout 10 zstub a',
      'timeout -s KILL 10 zstub a',
      'timeout --signal=TERM -k 1 10 zstub a',
      'timeout --preserve-status 5 zstub -x',
      'nohup zstub a',
      'nice zstub a',
      'nice -n 5 zstub a',
      'nice -5 zstub a',
      'nice --adjustment=3 zstub a',
      'stdbuf -o0 zstub a',
      'stdbuf -o L -e 0 zstub a',
      'stdbuf --output=L zstub a',
      'command zstub a',
      `command -p ${bin}/zstub a`,
      'builtin command zstub a',
      'exec zstub a',
      'exec -a name zstub a',
      'time zstub a',
      'time -p zstub a',
      'setsid zstub a',
      'setsid -w zstub a',
      'env nice -n 1 timeout 5 zstub a',
      'A=1 zstub a',
      'xargs zstub a',
      'xargs -0 zstub a',
      'xargs -n 1 zstub a',
      'xargs -I{} zstub {}',
      'xargs -d , zstub a',
    ];
    let compared = 0;
    for (const command of cases) {
      const run = spawnSync(BASH, ['--noprofile', '--norc', '-c', command], {
        cwd: EMPTY_DIR,
        env: { ...ORACLE_ENV, PATH: `${bin}:${process.env.PATH}` },
        input: command.startsWith('xargs')
          ? command.includes('-0')
            ? 'in\0'
            : command.includes('-d')
              ? 'in'
              : 'in\n'
          : '',
        encoding: 'utf8',
      });
      assert.equal(run.status, 0, `${command}: ${run.stderr}`);
      const argv = run.stdout.slice(0, -1).split('\0');
      const parsed = analyzeBash(command);
      assert.ok(parsed.ok, command);
      const resolved = parsed.commands[0];
      assert.equal(resolved.program, argv[0], command);
      // xargs adds its stdin to the arguments; the others pass them unchanged.
      const args = resolved.args.map((word) => word.value);
      if (resolved.stdinArgs) {
        assert.deepEqual(
          argv.slice(1, 1 + args.length).filter((v) => v !== 'in'),
          args.filter((v) => v !== '{}'),
          command,
        );
      } else {
        assert.deepEqual(argv.slice(1), args, command);
      }
      compared += 1;
    }
    t.diagnostic(`launcher oracle compared ${compared} command lines`);
  },
);

test('structure: operators, substitutions, heredocs and inline code are all commands', () => {
  const programs = (source) => {
    const result = analyzeBash(source);
    assert.ok(result.ok, `${source}: ${result.reason}`);
    return result.commands.map((command) => command.program);
  };
  assert.deepEqual(programs('a; b && c || d | e & f'), [
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
  ]);
  assert.deepEqual(programs('echo $(cat x) `rm y`').sort(), [
    'cat',
    'echo',
    'rm',
  ]);
  assert.deepEqual(programs('echo "${X:-$(id)}"').sort(), ['echo', 'id']);
  assert.deepEqual(programs('diff <(ls a) >(tee b)').sort(), [
    'diff',
    'ls',
    'tee',
  ]);
  assert.deepEqual(programs('( cd x; rm y )'), ['cd', 'rm']);
  assert.deepEqual(programs('{ rm y; }'), ['rm']);
  assert.deepEqual(programs('if true; then rm y; fi'), ['true', 'rm']);
  assert.deepEqual(programs('f() { curl x; }'), ['curl']);
  assert.deepEqual(programs('function f { curl x; }'), ['curl']);
  assert.deepEqual(programs('cat <<EOF\n$(rm y)\nEOF\n').sort(), ['cat', 'rm']);
  assert.deepEqual(programs("cat <<'EOF'\n$(rm y)\nEOF\n"), ['cat']);
  assert.deepEqual(programs('bash -c "curl x"'), ['bash', 'curl']);
  assert.deepEqual(programs("sh -lc 'curl x'"), ['sh', 'curl']);
  assert.deepEqual(programs('bash <<EOF\ncurl x\nEOF\n'), ['bash', 'curl']);
  assert.deepEqual(programs('bash <<< "curl x"'), ['bash', 'curl']);
  assert.deepEqual(programs('eval "curl x"'), ['eval', 'curl']);
  assert.deepEqual(programs("env -S 'curl x'"), [null, 'curl']);
  assert.deepEqual(programs('find . -exec rm {} \\;'), ['find', 'rm']);
  assert.deepEqual(programs("xargs sh -c 'curl x'"), ['sh', 'curl']);
  assert.deepEqual(programs("watch -n 1 'curl x'"), ['watch', 'curl']);
  assert.deepEqual(programs("pwsh -Command 'iwr x'"), ['pwsh', 'iwr']);
  assert.deepEqual(programs('[[ -f a && -f b ]] && cat a'), ['[[', 'cat']);
  assert.deepEqual(programs('# comment\ncat a # b'), ['cat']);
});

test('structure: redirections, fds, assignments and dynamic words are recorded', () => {
  const [command] = parseBash(
    'A=1 cat x 2>/dev/null >out 3<&0 {fd}>f <<<here',
  ).commands;
  assert.deepEqual(
    command.assignments.map((w) => w.value),
    ['A=1'],
  );
  assert.deepEqual(
    command.words.map((w) => w.value),
    ['cat', 'x'],
  );
  assert.deepEqual(
    command.redirects.map((r) => [r.fd, r.op, r.target?.value]),
    [
      ['2', '>', '/dev/null'],
      [null, '>', 'out'],
      ['3', '<&', '0'],
      ['{fd}', '>', 'f'],
      [null, '<<<', 'here'],
    ],
  );
  const [words] = parseBash(
    'curl "https://api.example.com/$ID" $HOST ~/x *.json a{b,c}',
  ).commands;
  const [, url, host, home, glob, brace] = words.words;
  assert.equal(url.dynamic, true);
  assert.equal(url.value.slice(0, url.dynamicAt), 'https://api.example.com/');
  assert.equal(host.dynamic, true);
  assert.equal(host.dynamicAt, 0);
  assert.equal(home.tilde, true);
  assert.equal(glob.glob, true);
  assert.equal(brace.brace, true);
});

test('unparseable command lines are reported, never guessed', () => {
  for (const source of [
    "echo 'open",
    'echo "open',
    'echo $(open',
    'echo `open',
    'echo )',
    "echo $'open",
    'case x in a) ls;; esac',
    'cat <<"EO',
  ]) {
    assert.equal(parseBash(source).ok, false, source);
  }
  assert.equal(analyzeBash("bash -c 'echo \"open'").ok, false);
});

test('launchers: dynamic options hide the program; lookups run nothing', () => {
  const unwrap = (source) => unwrapCommand(parseBash(source).commands[0].words);
  assert.equal(unwrap('env $OPTS curl x').dynamicProgram, true);
  assert.equal(unwrap('$CURL x').dynamicProgram, true);
  assert.equal(unwrap('command -v curl').lookupOnly, true);
  assert.equal(unwrap('sudo -E -u root /usr/bin/curl x').program, 'curl');
  assert.deepEqual(unwrap('sudo -E -u root /usr/bin/curl x').launchers, [
    'sudo',
  ]);
  assert.equal(unwrap('doas -u root curl x').program, 'curl');
  assert.equal(unwrap('CURL.EXE x').program, 'curl');
  assert.equal(unwrap('"C:\\Windows\\System32\\curl.exe" x').program, 'curl');
  assert.equal(unwrap('xargs').program, 'echo');
  assert.equal(unwrap('xargs curl').stdinArgs, true);
});

test('PowerShell is read conservatively', () => {
  const programs = (source) => {
    const result = parsePowerShell(source);
    assert.ok(result.ok, `${source}: ${result.reason}`);
    return result.commands.map((command) => command.program);
  };
  assert.deepEqual(programs("& 'C:\\Windows\\System32\\curl.exe' -d x host"), [
    'curl',
  ]);
  assert.deepEqual(programs('Get-Content a; Remove-Item b | Out-Null'), [
    'get-content',
    'remove-item',
    'out-null',
  ]);
  assert.deepEqual(programs('Get-Content (Remove-Item x)').sort(), [
    'get-content',
    'remove-item',
  ]);
  assert.deepEqual(programs('$x = $(iwr y)').sort(), ['iwr', null]);
  const [iwr] = parsePowerShell('iwr -Uri "https://$h/x" -Body a').commands;
  assert.equal(iwr.args[1].dynamic, true);
  assert.equal(
    parsePowerShell("Write-Output 'it''s'").commands[0].args[0].value,
    "it's",
  );
  assert.equal(
    parsePowerShell('Write-Output "a`"b"').commands[0].args[0].value,
    'a"b',
  );
  for (const source of [
    "Get-Content 'open",
    'Get-Content (x',
    "@'\nno end",
    'Get-Content )',
  ]) {
    assert.equal(parsePowerShell(source).ok, false, source);
  }
});
