// SPDX-License-Identifier: AGPL-3.0-only

// rc.2 item 3 (Astra R1): shell commands that name Claude Code settings,
// plugin files or hooks, read with the shared tokenizer.
//
// Owner rule (2026-09-27): in `pass` mode (the default) only a command that
// clearly writes, deletes or runs against a protected path is denied; reads,
// and whatever the tokenizer cannot read, pass (the latter recorded as
// `unparseable`). In `block` mode (ZEROH_UNCERTAIN=block) a command naming a
// protected path must be a plain read with cat, head, tail, wc, ls, stat or
// jq and listed options only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runHook, tempProject } from './helpers.mjs';
import {
  deniesClaudeControlChange,
  deniesZeroHSettings,
  protectedShellDecision,
} from '../lib/settings-guard.js';
import { sessionDir } from '../lib/session.js';

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-rc2-protected-'));
  const home = path.join(directory, 'home');
  const plugin = path.join(directory, 'installed-plugin');
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  mkdirSync(path.join(plugin, 'hooks'), { recursive: true });
  const settings = path.join(home, '.claude', 'settings.json');
  const hooks = path.join(plugin, 'hooks', 'hooks.json');
  const script = path.join(plugin, 'hooks', 'post.sh');
  const reset = () => {
    writeFileSync(settings, '{"env":{"ZEROHFAKE":"1"}}\n');
    writeFileSync(hooks, '{"hooks":{}}\n');
    writeFileSync(script, 'echo ZEROHFAKE\n');
  };
  reset();
  return {
    directory,
    home,
    plugin,
    settings,
    hooks,
    script,
    reset,
    options: { env: { HOME: home }, pluginDir: plugin },
  };
}

const RG_PRE_SPELLINGS = [
  '--pre',
  '--p"re"',
  '--p\\re',
  "$'--pre'",
  '"--"pre',
  '--pre=rm',
];

test('pass mode: rg --pre in every spelling runs rm, and is denied (Astra R1)', () => {
  const f = fixture();
  const rg = spawnSync('rg', ['--version'], { encoding: 'utf8' });
  for (const spelling of RG_PRE_SPELLINGS) {
    const command = spelling.endsWith('=rm')
      ? `rg ${spelling} ZEROHFAKE ${f.settings}`
      : `rg ${spelling} rm ZEROHFAKE ${f.settings}`;
    for (const tool of ['Bash', 'Monitor']) {
      assert.equal(
        deniesZeroHSettings(tool, { command }, f.directory, f.options),
        true,
        `${tool}: ${command}`,
      );
    }
    // The fixture shows what the denied command does.
    if (rg.status === 0) {
      spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', command], {
        cwd: f.directory,
      });
      assert.equal(existsSync(f.settings), false, `bash ran rm: ${command}`);
      f.reset();
    }
  }
});

test('pass mode: the real PreToolUse hook denies rg --pre in every spelling', () => {
  const p = tempProject();
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-rc2-home-'));
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  const settings = path.join(home, '.claude', 'settings.json');
  writeFileSync(settings, '{}\n');
  const extraEnv = {
    HOME: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
  };
  for (const spelling of RG_PRE_SPELLINGS) {
    const command = `rg ${spelling}${spelling.endsWith('=rm') ? '' : ' rm'} ZEROHFAKE ${settings}`;
    const { json } = runHook(
      'pre-tool-use',
      { tool_name: 'Bash', tool_input: { command } },
      { project: p, extraEnv },
    );
    assert.equal(json?.hookSpecificOutput?.permissionDecision, 'deny', command);
    assert.ok(!('updatedInput' in json.hookSpecificOutput), command);
  }
  // A plain search of the same file runs.
  const { json } = runHook(
    'pre-tool-use',
    { tool_name: 'Bash', tool_input: { command: `rg ZEROHFAKE ${settings}` } },
    { project: p, extraEnv },
  );
  assert.notEqual(json?.hookSpecificOutput?.permissionDecision, 'deny');
});

test('pass mode: commands that clearly write, delete or run against protected paths are denied', () => {
  const f = fixture();
  const s = f.settings;
  const denied = [
    `rm ${s}`,
    `rm -f ~/.claude/settings.json`,
    `rm ~/.cl"aude"/settings.json`,
    `mv ${s} /tmp/zerohfake.json`,
    `cp /tmp/zerohfake.json ${s}`,
    `cp -t ${f.plugin}/hooks /tmp/x.sh`,
    `sed -i s/1/0/ ${s}`,
    `sed -Ei.bak s/1/0/ ${s}`,
    `perl -pi -e s/1/0/ ${s}`,
    `echo {} > ${s}`,
    `echo x >> ${f.hooks}`,
    `jq . ${s} | tee ${s}`,
    `chmod 000 ${s}`,
    `truncate -s0 ${s}`,
    `dd if=/dev/null of=${s}`,
    `find ${f.home}/.claude -name settings.json -delete`,
    `find ${f.home}/.claude -exec rm {} +`,
    `echo ${s} | xargs rm`,
    `sh ${f.script}`,
    `bash ${f.script}`,
    `python3 -c "open('${s}','w')"`,
    `node -e "require('fs').unlinkSync('${s}')"`,
    `env -u ZEROHFAKE rm ${s}`,
    `/usr/bin/env rm ${s}`,
    `sudo rm ${s}`,
    `timeout 5 rm ${s}`,
    `bash -c "rm ${s}"`,
    `true && rm ${s}`,
    `echo $(rm ${s})`,
    `git rm ${s}`,
    `less +!rm ${s}`,
  ];
  for (const command of denied) {
    for (const tool of ['Bash', 'Monitor']) {
      assert.equal(
        deniesClaudeControlChange(tool, { command }, f.directory, f.options),
        true,
        `${tool}: ${command}`,
      );
    }
  }
  for (const command of [
    `Remove-Item ${s}`,
    `Set-Content ${s} '{}'`,
    `Copy-Item C:\\zerohfake.json ${s}`,
    `'{}' > ${s}`,
    `Get-Content (Remove-Item ${s})`,
  ]) {
    assert.equal(
      deniesClaudeControlChange(
        'PowerShell',
        { command },
        f.directory,
        f.options,
      ),
      true,
      `PowerShell: ${command}`,
    );
  }
});

test('pass mode: reads, searches and other work on protected paths run', () => {
  const f = fixture();
  const s = f.settings;
  for (const command of [
    `cat ${s}`,
    'cat ~/.claude/settings.json',
    `grep -n hooks ${s}`,
    `rg ZEROHFAKE ${f.plugin}`,
    `rg --pre-glob '*.pdf' ZEROHFAKE ${s}`,
    `cat "$(echo ${s})"`,
    `jq .env ${s}`,
    `diff ${s} /tmp/zerohfake.json`,
    `cp ${s} /tmp/zerohfake-backup.json`,
    `python3 scripts/check.py ${s}`,
    `less ${s}`,
    `ls -la ${f.plugin}/hooks`,
    `git diff -- ${s}`,
  ]) {
    const decision = protectedShellDecision(
      'Bash',
      { command },
      f.directory,
      f.options,
    );
    assert.equal(decision.deny, false, command);
    assert.equal(decision.unchecked, null, command);
  }
  for (const command of [`Get-Content ${s}`, `Select-String ZEROHFAKE ${s}`]) {
    assert.equal(
      protectedShellDecision('PowerShell', { command }, f.directory, f.options)
        .deny,
      false,
      command,
    );
  }
  // Unreadable: it passes, and says so.
  const unreadable = protectedShellDecision(
    'Bash',
    { command: `case x in a) cat ${s};; esac` },
    f.directory,
    f.options,
  );
  assert.deepEqual(unreadable, {
    deny: false,
    reason: null,
    unchecked: 'unparseable',
  });
});

test('block mode: only plain reads with listed options, nothing unparseable', () => {
  const f = fixture();
  const s = f.settings;
  const options = { ...f.options, mode: 'block' };
  const decide = (command, tool = 'Bash') =>
    protectedShellDecision(tool, { command }, f.directory, options).deny;
  for (const command of [
    `cat ${s}`,
    `cat -n ${s}`,
    `head -n 5 ${s}`,
    `head -5 ${s}`,
    `tail -20 ${s}`,
    `wc -l ${s}`,
    `ls -la ${f.home}/.claude`,
    `stat -c %s ${s}`,
    `jq -r .env ${s}`,
    `jq --arg k env '.[$k]' ${s}`,
    `cat ${s} 2>/dev/null`,
    `cat ${s} | jq .`,
  ]) {
    assert.equal(decide(command), false, command);
  }
  for (const command of [
    `grep -n hooks ${s}`,
    `rg ZEROHFAKE ${s}`,
    `less ${s}`,
    `more ${s}`,
    `cat ${s} | sh`,
    `cat "$(echo ${s})"`,
    `jq -f /tmp/prog.jq ${s}`,
    `jq --rawfile x /tmp/y . ${s}`,
    `jq --slurpfile x /tmp/y . ${s}`,
    `jq --args . ${s} a`,
    `head --unknown ${s}`,
    `env cat ${s}`,
    `LD_PRELOAD=/tmp/x.so cat ${s}`,
    `cat ${s} > /tmp/copy.json`,
    `case x in a) cat ${s};; esac`,
    `python3 scripts/check.py ${s}`,
    `rm ${s}`,
  ]) {
    assert.equal(decide(command), true, command);
  }
  assert.equal(decide(`Get-Content ${s}`, 'PowerShell'), true);
});

test('the PreToolUse hook: pass by default, block when asked, and unparseable reads recorded', () => {
  const p = tempProject();
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-rc2-home-'));
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  const settings = path.join(home, '.claude', 'settings.json');
  writeFileSync(settings, '{}\n');
  const base = { HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude') };
  const decision = (command, extraEnv = {}) =>
    runHook(
      'pre-tool-use',
      { tool_name: 'Bash', tool_input: { command } },
      { project: p, extraEnv: { ...base, ...extraEnv } },
    ).json?.hookSpecificOutput?.permissionDecision ?? 'allow';
  const dir = sessionDir(p.dir, 'test', {
    ...process.env,
    ZEROH_HOME: p.home,
    HOME: p.home,
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ turnCount: 1 }));
  writeFileSync(path.join(dir, 'turn-1.json'), JSON.stringify({ turn: 1 }));

  assert.equal(decision(`grep -n hooks ${settings}`), 'allow');
  assert.equal(
    decision(`grep -n hooks ${settings}`, { ZEROH_UNCERTAIN: 'block' }),
    'deny',
  );
  assert.equal(decision(`rm ${settings}`), 'deny');
  assert.equal(decision(`case x in a) cat ${settings};; esac`), 'allow');
  const ledger = JSON.parse(
    readFileSync(path.join(dir, 'turn-1.json'), 'utf8'),
  );
  assert.equal(ledger.audit?.unchecked?.unparseable?.Bash, 1);
  assert.equal(
    decision(`case x in a) cat ${settings};; esac`, {
      ZEROH_UNCERTAIN: 'block',
    }),
    'deny',
  );
});
