// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import { callMcpTool, mcpClient } from './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_PREFIXES,
  publicPrefix,
  reportMiss,
  resultText,
  validateMissInput,
} from '../lib/report-miss.js';
import { scrubDeep } from '../lib/secrets.js';
import { Vault } from '../lib/vault.js';

const CATALOG = JSON.parse(
  readFileSync(
    new URL('../lib/rules/gitleaks.generated.json', import.meta.url),
    'utf8',
  ),
);
const PLUGIN_VERSION = JSON.parse(
  readFileSync(
    new URL('../.claude-plugin/plugin.json', import.meta.url),
    'utf8',
  ),
).version;

const SERVER = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));
const CLI = fileURLToPath(
  new URL('../bin/zeroh-disclosure.mjs', import.meta.url),
);
const RUN_HOOK = fileURLToPath(new URL('../hooks/run.js', import.meta.url));
const MISSED = 'zhmiss_ZEROHFAKE7qN4vB8xK2mP6sT9wC3yF5jH1rL0dG4aZ8uE2kWq';

function fixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-report-miss-'));
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  const zeroh = path.join(base, 'zeroh-home');
  mkdirSync(root);
  mkdirSync(home);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    ZEROH_HOME: zeroh,
    ZEROH_CREDENTIAL_HOME: home,
    ZEROH_CLAUDE_SETTINGS: path.join(base, 'claude-settings', 'settings.json'),
    ZEROH_SERVICE_MANAGER_DIR: path.join(base, 'service-manager'),
    CLAUDE_SESSION_ID: 'report-miss-test-session',
    CLAUDE_CODE_VERSION: 'ZEROHFAKE-claude-version',
  };
  return { base, root, home, zeroh, env };
}

function client(project, { elicitation = true, entrypoint = null } = {}) {
  return mcpClient({
    cwd: project.root,
    env: project.env,
    elicitation,
    entrypoint,
  });
}

function callTool(instance, id, arguments_) {
  return callMcpTool(instance, id, 'report_missed_secret', arguments_);
}

function directInput(value = MISSED) {
  return {
    value,
    type_guess: 'SECRET',
    where: 'Bash output from file .env',
    why: 'random-looking credential',
  };
}

function reportFiles(project) {
  const directory = path.join(project.zeroh, 'reports');
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(directory, name));
  } catch {
    return [];
  }
}

test('report_missed_secret masks the exact value in the next PostToolUse output', async (t) => {
  const project = fixture();
  const instance = client(project, { elicitation: false });
  t.after(() => instance.stop());
  await instance.ready;
  const response = await callTool(instance, 2, directInput());
  const text = response.result.content[0].text;
  const token = text.match(/\[SECRET-[0-9a-f]{6}\]/u)?.[0];
  assert.ok(token);
  assert.match(text, /saved locally/u);

  const hook = spawnSync(process.execPath, [RUN_HOOK, 'post-tool-use'], {
    cwd: project.root,
    env: project.env,
    input: JSON.stringify({
      session_id: 'report-miss-test-session',
      cwd: project.root,
      tool_name: 'Bash',
      tool_response: `AFTER_REPORT ${MISSED}`,
    }),
    encoding: 'utf8',
  });
  assert.equal(hook.status, 0, hook.stderr);
  const output = JSON.parse(hook.stdout.trim());
  assert.equal(
    output.hookSpecificOutput.updatedToolOutput,
    `AFTER_REPORT ${token}`,
  );

  const vault = new Vault(project.root, { env: project.env });
  assert.match(vault.entryOf(token).source, /^reported:[0-9a-f-]{36}$/u);
});

test('shape report and reports CLI never contain the planted value', () => {
  const project = fixture();
  const result = reportMiss(
    {
      ...directInput(),
      type_guess: MISSED,
      where: `file .env contained ${MISSED}`,
      why: MISSED,
    },
    { cwd: project.root, env: project.env },
  );
  const file = reportFiles(project)[0];
  const reportText = readFileSync(file, 'utf8');
  assert.doesNotMatch(reportText, new RegExp(MISSED, 'u'));
  assert.equal(result.report.file_extension, '.env');
  assert.equal(result.report.plugin_version, PLUGIN_VERSION);
  assert.equal(result.report.type, 'SECRET');
  assert.equal(result.report.claude_code_version, 'ZEROHFAKE-claude-version');

  for (const args of [
    ['reports', 'list'],
    ['reports', 'show', result.id],
    ['reports', 'show', result.id, '--json'],
  ]) {
    const cli = spawnSync(process.execPath, [CLI, ...args], {
      cwd: project.root,
      env: project.env,
      encoding: 'utf8',
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.doesNotMatch(cli.stdout, new RegExp(MISSED, 'u'));
  }

  const deleted = spawnSync(
    process.execPath,
    [CLI, 'reports', 'delete', result.id],
    { cwd: project.root, env: project.env, encoding: 'utf8' },
  );
  assert.equal(deleted.status, 0, deleted.stderr);
  assert.equal(reportFiles(project).length, 0);
});

test('public prefixes are limited to fixed catalog-backed provider prefixes', () => {
  assert.equal(publicPrefix(`github_pat_${'A'.repeat(52)}`), 'github_pat_');
  assert.equal(publicPrefix(`ghp_${'A'.repeat(36)}`), 'ghp_');
  assert.equal(publicPrefix(`sk_live_${'A'.repeat(24)}`), 'sk_live_');
  assert.equal(publicPrefix(`AKIA${'A'.repeat(16)}`), 'AKIA');
  assert.equal(publicPrefix(MISSED), null);
  assert.equal(publicPrefix(`prefix_${'A'.repeat(40)}`), null);
  const keywords = CATALOG.rules.flatMap((rule) =>
    (rule.keywords ?? []).map((keyword) => keyword.toLowerCase()),
  );
  for (const prefix of PUBLIC_PREFIXES) {
    assert.ok(
      keywords.some((keyword) => prefix.toLowerCase().startsWith(keyword)),
      `${prefix} must be backed by a catalog keyword`,
    );
  }
});

test('the result names the token and adds a rotation hint only for a known prefix', () => {
  const github = resultText('[API_KEY-abc123]', `ghp_${'A'.repeat(36)}`);
  assert.match(
    github,
    /^Masked from now on as \[API_KEY-abc123\]\. Anything already sent can't be recalled: rotate this credential\./u,
  );
  assert.match(github, /github\.com\/settings\/tokens/u);
  assert.match(
    resultText('[API_KEY-abc123]', `AKIA${'A'.repeat(16)}`),
    /AWS IAM/u,
  );
  assert.doesNotMatch(resultText('[SECRET-abc123]', MISSED), /https?:/u);
});

test('a reported value is masked in a later proxied request body', () => {
  const project = fixture();
  const { token } = reportMiss(directInput(), {
    cwd: project.root,
    env: project.env,
  });
  const vault = new Vault(project.root, { env: project.env });
  const body = {
    messages: [{ role: 'user', content: `tool said ${MISSED} again` }],
  };
  const masked = scrubDeep(body, { vault, known: [], profile: 'prompt' });
  assert.equal(masked.messages[0].content, `tool said ${token} again`);
});

test('1.0 asks keep or delete, keep preselected; sending is shown as coming in 1.1', async (t) => {
  const project = fixture();
  const instance = client(project);
  t.after(() => instance.stop());
  await instance.ready;
  const responsePromise = callTool(instance, 2, directInput());
  const prompt = await instance.next(
    (message) => message.method === 'elicitation/create',
  );
  const field = prompt.params.requestedSchema.properties.action;
  assert.deepEqual(field.enum, ['Keep it on this computer', 'Delete it']);
  // T-23: a plain question, the safe answer preselected.
  assert.equal(field.default, 'Keep it on this computer');
  assert.equal(field.title, 'What should ZeroH do with this report?');
  assert.match(prompt.params.message, /→ changes the answer/u);
  assert.match(
    prompt.params.message,
    /sending reports to Blade Labs comes in 1\.1/iu,
  );
  assert.equal(JSON.stringify(prompt).includes(MISSED), false);
  // A client that sends an answer outside the enum still keeps the report local.
  instance.send({
    jsonrpc: '2.0',
    id: prompt.id,
    result: {
      action: 'accept',
      content: { action: 'Send to Blade Labs' },
    },
  });
  const response = await responsePromise;
  assert.match(response.result.content[0].text, /kept locally/u);
  assert.match(response.result.content[0].text, /nothing left this machine/iu);
  assert.equal(reportFiles(project).length, 1);
});

test('headless mode saves direct reports and refuses missing private input without hanging', async (t) => {
  const project = fixture();
  const instance = client(project, {
    elicitation: true,
    entrypoint: 'sdk-cli',
  });
  t.after(() => instance.stop());
  await instance.ready;
  const saved = await callTool(instance, 2, directInput());
  assert.match(saved.result.content[0].text, /saved locally/u);
  const refused = await callTool(instance, 3, {});
  assert.match(refused.result.content[0].text, /needs an interactive/u);
  assert.equal(reportFiles(project).length, 1);
});

test('manual report flow collects the value in elicitation and can keep it local', async (t) => {
  const project = fixture();
  const instance = client(project);
  t.after(() => instance.stop());
  await instance.ready;
  const responsePromise = callTool(instance, 2, {});
  const inputPrompt = await instance.next(
    (message) => message.method === 'elicitation/create',
  );
  assert.equal(
    inputPrompt.params.requestedSchema.properties.value.title,
    'Value to mask',
  );
  instance.send({
    jsonrpc: '2.0',
    id: inputPrompt.id,
    result: { action: 'accept', content: directInput() },
  });
  const actionPrompt = await instance.next(
    (message) => message.method === 'elicitation/create',
  );
  assert.equal(JSON.stringify(actionPrompt).includes(MISSED), false);
  instance.send({
    jsonrpc: '2.0',
    id: actionPrompt.id,
    result: {
      action: 'accept',
      content: { action: 'Keep it on this computer' },
    },
  });
  const response = await responsePromise;
  assert.match(response.result.content[0].text, /kept locally/u);
  assert.equal(reportFiles(project).length, 1);
});

test('Delete it deletes the shape report but keeps the value masked', async (t) => {
  const project = fixture();
  const instance = client(project);
  t.after(() => instance.stop());
  await instance.ready;
  const responsePromise = callTool(instance, 2, directInput());
  const prompt = await instance.next(
    (message) => message.method === 'elicitation/create',
  );
  // One line saying what the report holds; never the value.
  assert.match(
    prompt.params.message,
    new RegExp(
      `^The report holds only: type \\w+, ${MISSED.length} characters, found in .+; never the value\\.$`,
      'mu',
    ),
  );
  assert.equal(prompt.params.message.includes(MISSED), false);
  instance.send({
    jsonrpc: '2.0',
    id: prompt.id,
    result: { action: 'accept', content: { action: 'Delete it' } },
  });
  const response = await responsePromise;
  assert.match(response.result.content[0].text, /discarded/u);
  assert.equal(reportFiles(project).length, 0);
  const vault = new Vault(project.root, { env: project.env });
  assert.ok(
    vault.knownValues().some((entry) => entry.value === MISSED),
    'the vault mapping survives a discarded report',
  );
});

test('report_missed_secret rate-limits to 20 reports per MCP session', async (t) => {
  const project = fixture();
  const instance = client(project, { elicitation: false });
  t.after(() => instance.stop());
  await instance.ready;
  for (let index = 0; index < 20; index += 1) {
    const response = await callTool(
      instance,
      index + 2,
      directInput(
        `zhmiss_ZEROHFAKE_${String(index).padStart(2, '0')}_abcdefghijk`,
      ),
    );
    assert.match(response.result.content[0].text, /saved locally/u);
  }
  const refused = await callTool(
    instance,
    30,
    directInput('zhmiss_ZEROHFAKE_20_abcdefghijk'),
  );
  assert.match(refused.result.content[0].text, /limit of 20 reports/u);
  const noDialog = await callTool(instance, 31, {});
  assert.match(noDialog.result.content[0].text, /limit of 20 reports/u);
  assert.equal(reportFiles(project).length, 20);
});

test('report input rejects short, whitespace-only, oversized, and incomplete values', () => {
  for (const input of [
    directInput('short'),
    directInput('        '),
    directInput('x'.repeat(4097)),
    { value: MISSED, where: '', why: 'sensitive' },
    { value: MISSED, where: 'Bash output', why: '' },
    directInput('[SECRET-abc123]'),
    directInput(42),
  ]) {
    assert.throws(() => validateMissInput(input));
  }
});
