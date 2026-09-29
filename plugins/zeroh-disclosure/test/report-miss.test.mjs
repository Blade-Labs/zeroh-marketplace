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
  modelReportNotice,
  publicPrefix,
  reportMiss,
  resultText,
  validateMissInput,
} from '../lib/report-miss.js';
import { scrubDeep } from '../lib/secrets.js';
import { slashToCli } from '../lib/user-authority.js';
import { asUser } from './as-user.mjs';
import { Vault } from '../lib/vault.js';

const CATALOG = JSON.parse(
  readFileSync(
    new URL(
      '../vendor/sensitive-data-detectors/src/rules/gitleaks.generated.json',
      import.meta.url,
    ),
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
  assert.match(
    text,
    /Local note [0-9a-f-]{36} kept; reports stay on this computer/u,
  );

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

  // Deleting a note is the user's: without their typed command nothing
  // changes (lib/user-authority.js).
  const refused = spawnSync(
    process.execPath,
    [CLI, 'reports', 'delete', result.id],
    {
      cwd: project.root,
      env: { ...project.env, CLAUDE_CODE_SESSION_ID: 'model-session' },
      encoding: 'utf8',
    },
  );
  assert.equal(refused.status, 0, refused.stderr);
  assert.match(refused.stdout, /^Nothing changed/mu);
  assert.match(refused.stdout, /\/zeroh-disclosure:report-miss delete /u);
  assert.equal(reportFiles(project).length, 1);
  const args = ['reports', 'delete', result.id];
  const deleted = spawnSync(process.execPath, [CLI, ...args], {
    cwd: project.root,
    env: asUser(args, project.env),
    encoding: 'utf8',
  });
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

test('a report Claude makes itself opens no dialog: masked, note kept, one line for the user', async (t) => {
  const project = fixture();
  // An interactive client: a dialog would block the answer until answered.
  const instance = client(project);
  t.after(() => instance.stop());
  await instance.ready;
  const input = {
    ...directInput(),
    where:
      'Bash output from file config/internal.env (WEBHOOK_URL path segment)',
  };
  const response = await callTool(instance, 2, input);
  const text = response.result.content[0].text;
  const token = text.match(/\[SECRET-[0-9a-f]{6}\]/u)?.[0];
  assert.ok(token, text);
  assert.match(text, /reports stay on this computer/u);
  assert.equal(text.includes(MISSED), false);
  assert.equal(reportFiles(project).length, 1);
  const vault = new Vault(project.root, { env: project.env });
  assert.ok(vault.knownValues().some((entry) => entry.value === MISSED));

  // The PostToolUse hook tells the user in one plain line.
  const hook = spawnSync(process.execPath, [RUN_HOOK, 'post-tool-use'], {
    cwd: project.root,
    env: project.env,
    input: JSON.stringify({
      session_id: 'report-miss-test-session',
      cwd: project.root,
      tool_name:
        'mcp__plugin_zeroh-disclosure_zeroh-disclosure__report_missed_secret',
      tool_input: input,
      tool_response: response.result.content,
    }),
    encoding: 'utf8',
  });
  assert.equal(hook.status, 0, hook.stderr);
  const output = JSON.parse(hook.stdout.trim().split('\n').pop());
  assert.equal(
    output.systemMessage,
    'ZeroH Disclosure: Claude spotted a value ZeroH missed in config/internal.env; it is masked from now on. `/zeroh-disclosure:report-miss list` shows or deletes these notes.',
  );
  assert.equal(hook.stdout.includes(MISSED), false);
  assert.equal(
    modelReportNotice({ value: MISSED, where: 'somewhere' }),
    'ZeroH Disclosure: Claude spotted a value ZeroH missed; it is masked from now on. `/zeroh-disclosure:report-miss list` shows or deletes these notes.',
  );
});

// Astra 1.0.1 A1: `where` comes from Claude and may hold another secret;
// the notice never prints it.
test('the report notice never prints another secret from the place Claude gave', async (t) => {
  const project = fixture();
  const KNOWN = 'sk_live_ZEROHFAKE0000000000000000';
  const DETECTED = `ghp_${'ZEROHFAKE'.padEnd(36, '7')}`;
  const vault = new Vault(project.root, { env: project.env });
  vault.tokenFor('API_KEY', KNOWN);
  vault.save();
  const instance = client(project);
  t.after(() => instance.stop());
  await instance.ready;
  let id = 10;
  for (const secret of [KNOWN, DETECTED]) {
    const input = {
      ...directInput(`${MISSED}${id}`),
      where: `file logs/${secret}.log`,
    };
    const response = await callTool(instance, (id += 1), input);
    const hook = spawnSync(process.execPath, [RUN_HOOK, 'post-tool-use'], {
      cwd: project.root,
      env: project.env,
      input: JSON.stringify({
        session_id: 'report-miss-test-session',
        cwd: project.root,
        tool_name:
          'mcp__plugin_zeroh-disclosure_zeroh-disclosure__report_missed_secret',
        tool_input: input,
        tool_response: response.result.content,
      }),
      encoding: 'utf8',
    });
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stdout.includes(secret), false, hook.stdout);
    assert.equal(hook.stdout.includes(secret.slice(0, 12)), false, hook.stdout);
    const output = JSON.parse(hook.stdout.trim().split('\n').pop());
    assert.equal(
      output.systemMessage,
      'ZeroH Disclosure: Claude spotted a value ZeroH missed; it is masked from now on. `/zeroh-disclosure:report-miss list` shows or deletes these notes.',
    );
  }
  // Without the hook's masker, no place at all.
  assert.doesNotMatch(
    modelReportNotice({ value: MISSED, where: 'file config/internal.env' }),
    / in config/u,
  );
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
  assert.match(
    saved.result.content[0].text,
    /kept; reports stay on this computer/u,
  );
  const refused = await callTool(instance, 3, {});
  assert.match(refused.result.content[0].text, /needs an interactive/u);
  assert.equal(reportFiles(project).length, 1);
});

test("the user's report-miss is one private form: Submit masks and keeps the note, Cancel changes nothing", async (t) => {
  const project = fixture();
  const instance = client(project);
  t.after(() => instance.stop());
  await instance.ready;
  const responsePromise = callTool(instance, 2, {});
  const form = await instance.next(
    (message) => message.method === 'elicitation/create',
  );
  assert.equal(
    form.params.requestedSchema.properties.value.title,
    'Value to mask',
  );
  assert.equal(form.params.requestedSchema.properties.action, undefined);
  assert.match(form.params.message, /Submit masks it from now on/u);
  assert.match(form.params.message, /Cancel changes nothing/u);
  assert.match(form.params.message, /Reports stay on this computer\./u);
  assert.doesNotMatch(form.params.message, /Enter keeps|→|1\.1/u);
  instance.send({
    jsonrpc: '2.0',
    id: form.id,
    result: { action: 'accept', content: directInput() },
  });
  // No second question: the answer comes back at once.
  const response = await responsePromise;
  assert.match(response.result.content[0].text, /Local note .* kept/u);
  assert.equal(reportFiles(project).length, 1);

  const cancelled = callTool(instance, 3, {});
  const again = await instance.next(
    (message) => message.method === 'elicitation/create',
  );
  instance.send({ jsonrpc: '2.0', id: again.id, result: { action: 'cancel' } });
  assert.match(
    (await cancelled).result.content[0].text,
    /nothing was masked or saved/u,
  );
  assert.equal(reportFiles(project).length, 1);
});

test('the report-miss command lists notes and maps delete to the user-only CLI', () => {
  assert.deepEqual(slashToCli('report-miss', ['delete', 'abc']), [
    'reports',
    'delete',
    'abc',
  ]);
  assert.equal(slashToCli('report-miss', []), null);
  assert.equal(slashToCli('report-miss', ['list']), null);
  const command = readFileSync(
    new URL('../commands/report-miss.md', import.meta.url),
    'utf8',
  );
  assert.match(command, /^disable-model-invocation: true$/mu);
  const project = fixture();
  const script = fileURLToPath(
    new URL('../commands/scripts/report-miss.js', import.meta.url),
  );
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: project.root,
      env: { ...project.env, CLAUDE_PROJECT_DIR: project.root },
      encoding: 'utf8',
    }).stdout;
  assert.match(run(), /^Report a value: /u);
  assert.match(run('list'), /No local notes/u);
  const { id } = reportMiss(directInput(), {
    cwd: project.root,
    env: project.env,
  });
  const listed = run('list');
  assert.match(listed, new RegExp(id, 'u'));
  assert.equal(listed.includes(MISSED), false);
  assert.match(run('delete', id), /^Nothing changed/mu);
  assert.equal(reportFiles(project).length, 1);
});

test('no shipped string promises sending reports to Blade Labs in 1.1', () => {
  const plugin = fileURLToPath(new URL('..', import.meta.url));
  const skip = new Set(['node_modules', 'vendor', 'test', 'internal']);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:m?js|md|json)$/u.test(entry.name)) files.push(full);
    }
  };
  walk(plugin);
  for (const file of files) {
    let text = readFileSync(file, 'utf8');
    // The CHANGELOG keeps what 1.0.0 said, in its own section.
    if (path.basename(file) === 'CHANGELOG.md')
      text = text.slice(0, text.search(/^## 1\.0\.0\b/mu) >>> 0);
    assert.doesNotMatch(
      text,
      /(?:send|sending)[^.\n]*(?:Blade Labs)[^.\n]*1\.1|comes in 1\.1/iu,
      file,
    );
  }
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
    assert.match(response.result.content[0].text, /Local note .* kept/u);
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
