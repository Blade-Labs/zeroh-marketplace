// SPDX-License-Identifier: AGPL-3.0-only

// Product rule 8 (docs/product-principles.md): never mask what ZeroH can't
// restore. A vault that opens but can't be SAVED (a lock held by another
// writer, a read-only folder) must not turn a value into a token nothing can
// put back: every mask path (PostToolUse, PreToolUse, the proxy) masks only
// the values already on disk and passes the new ones unmasked, recorded as
// `vault-unsaveable` with the standard "not protected" line. UserPromptSubmit
// says the same. Block mode withholds or stops, as for a vault that can't be
// opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  FAKE_STRIPE,
  fakeUpstream,
  PLUGIN,
  postJson,
  runHook,
  tempProject,
  vaultUnsaveable,
} from './helpers.mjs';
import { ensureDefaultProxy, stopDefaultProxy } from '../lib/proxy-manager.js';
import { signedTurnSummary, turnSummary } from '../lib/turn-summary.js';
import { verifyReceiptArtifact } from '../lib/verify-receipt.js';
import { TOKEN_RE } from '../lib/token-pattern.js';
import { sessionDir } from '../lib/session.js';
import { Vault } from '../lib/vault.js';
import { createMaskingProxy, listen } from '../lib/proxy.js';
import { uncheckedNotice } from '../lib/unchecked.js';

const BLOCK = { ZEROH_UNCERTAIN: 'block' };
// A fake GitHub token: shape-certain, never on disk before the save fails.
const FAKE_GITHUB = ['ghp', 'ZEROHFAKEgithubtoken0123456789abcdef'].join('_');
const TOKEN_ALL = new RegExp(TOKEN_RE.source, 'gu');

function envOf(p) {
  return { ...process.env, ZEROH_HOME: p.home, HOME: p.home };
}

function openTurn(p, sessionId = 'test') {
  const dir = sessionDir(p.dir, sessionId, envOf(p));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ turnCount: 1 }));
  writeFileSync(path.join(dir, 'turn-1.json'), JSON.stringify({ turn: 1 }));
  return path.join(dir, 'turn-1.json');
}

function ledgerOf(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function hook(p, name, event, extraEnv = {}) {
  const result = runHook(
    name,
    { tool_use_id: 'unsaveable', ...event },
    { project: p, extraEnv },
  );
  assert.equal(result.code, 0, result.stderr);
  return result.json ?? {};
}

// The token PostToolUse gives the .env Stripe key, saved to disk.
function persistedStripeToken(p) {
  const json = hook(p, 'post-tool-use', {
    tool_name: 'Bash',
    tool_input: { command: 'cat .env' },
    tool_response: { stdout: `STRIPE_KEY=${FAKE_STRIPE}`, stderr: '' },
  });
  const token =
    json.hookSpecificOutput.updatedToolOutput.stdout.match(TOKEN_RE)[0];
  assert.equal(new Vault(p.dir, { env: envOf(p) }).valueOf(token), FAKE_STRIPE);
  return token;
}

// Every token in `text` resolves from the vault on disk.
function assertRestorable(p, text, label) {
  const vault = new Vault(p.dir, { env: envOf(p) });
  for (const token of String(text).match(TOKEN_ALL) ?? []) {
    assert.ok(
      vault.valueOf(token),
      `${label}: ${token} is not on disk, so nothing can put it back`,
    );
  }
}

const NOTICE =
  /not protected \(ZeroH couldn't save its vault\) · \/zeroh-disclosure:doctor/u;

test('the notice line for vault-unsaveable', () => {
  assert.equal(
    uncheckedNotice('vault-unsaveable', { subject: 'tool output' }),
    "ZeroH Disclosure: this tool output was not protected (ZeroH couldn't save its vault) · /zeroh-disclosure:doctor",
  );
});

test('PostToolUse: a vault that opens but cannot save masks only what is on disk; block mode withholds', async () => {
  const p = tempProject();
  const token = persistedStripeToken(p);
  const ledger = openTurn(p);
  const restore = await vaultUnsaveable(p);
  try {
    const stdout = `STRIPE_KEY=${FAKE_STRIPE}\nGITHUB_TOKEN=${FAKE_GITHUB}\n`;
    const events = [
      {
        tool_name: 'Bash',
        tool_input: { command: 'cat .env' },
        tool_response: { stdout, stderr: '' },
      },
      {
        tool_name: 'Read',
        tool_input: { file_path: path.join(p.dir, '.env') },
        tool_response: {
          type: 'text',
          file: {
            filePath: path.join(p.dir, '.env'),
            content: stdout,
            numLines: 2,
            startLine: 1,
            totalLines: 2,
          },
        },
      },
      {
        tool_name: 'Read',
        tool_input: { file_path: path.join(p.dir, 'n.ipynb') },
        tool_response: {
          type: 'notebook',
          file: {
            filePath: path.join(p.dir, 'n.ipynb'),
            cells: [{ cell_type: 'code', source: stdout }],
          },
        },
      },
      {
        tool_name: 'mcp__server__fetch',
        tool_input: {},
        tool_response: [{ type: 'text', text: stdout }],
      },
    ];
    for (const event of events) {
      const json = hook(p, 'post-tool-use', event);
      const out = JSON.stringify(json.hookSpecificOutput?.updatedToolOutput);
      // The value on disk stays masked; the new one passes as it is.
      assert.ok(out.includes(token), `${event.tool_name}: ${out}`);
      assert.ok(!out.includes(FAKE_STRIPE), event.tool_name);
      assert.ok(out.includes(FAKE_GITHUB), `${event.tool_name}: ${out}`);
      assertRestorable(p, JSON.stringify(json), event.tool_name);
    }
    const counts = ledgerOf(ledger).audit?.unchecked ?? {};
    assert.ok(counts['vault-unsaveable']?.Bash >= 1, JSON.stringify(counts));
    assert.ok(counts['vault-unsaveable']?.Read >= 2, JSON.stringify(counts));

    // The line, once per reason per turn, on a fresh turn.
    const fresh = openTurn(p);
    const shown = hook(p, 'post-tool-use', events[0]);
    assert.match(shown.systemMessage ?? '', NOTICE);
    assert.ok(ledgerOf(fresh).audit.unchecked['vault-unsaveable'].Bash >= 1);

    // Block mode withholds the output rather than sending the new value.
    const blocked = hook(p, 'post-tool-use', events[0], BLOCK);
    const text = JSON.stringify(blocked);
    assert.ok(!text.includes(FAKE_GITHUB));
    assert.ok(!text.includes(FAKE_STRIPE));
    assert.match(
      blocked.hookSpecificOutput.updatedToolOutput.stdout,
      /could not save its vault/u,
    );
  } finally {
    restore();
  }
});

test('PreToolUse: a raw secret written into a file is not swapped for a token that cannot be saved; block mode denies', async () => {
  const p = tempProject();
  const token = persistedStripeToken(p);
  const ledger = openTurn(p);
  const restore = await vaultUnsaveable(p);
  try {
    const input = {
      file_path: path.join(p.dir, 'config.txt'),
      content: `stripe=${FAKE_STRIPE}\ngithub=${FAKE_GITHUB}\n`,
    };
    const json = hook(p, 'pre-tool-use', {
      tool_name: 'Write',
      tool_input: input,
    });
    assert.notEqual(json.hookSpecificOutput?.permissionDecision, 'deny');
    const written = json.hookSpecificOutput?.updatedInput?.content ?? '';
    // The file gets the persisted token (it can be put back later) and the
    // new value as the model wrote it, never a dead token.
    assert.ok(written.includes(token), written);
    assert.ok(written.includes(FAKE_GITHUB), written);
    assertRestorable(p, JSON.stringify(json), 'Write');
    assert.match(json.systemMessage ?? '', /couldn't save its vault/u);
    assert.ok(
      ledgerOf(ledger).audit?.unchecked?.['vault-unsaveable']?.Write >= 1,
    );

    const blocked = hook(
      p,
      'pre-tool-use',
      { tool_name: 'Write', tool_input: input },
      BLOCK,
    );
    assert.equal(blocked.hookSpecificOutput?.permissionDecision, 'deny');
    assert.match(
      blocked.hookSpecificOutput.permissionDecisionReason,
      /could not save its vault/u,
    );
  } finally {
    restore();
  }
});

async function upstream() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  const port = await listen(server);
  return { server, seen, url: `http://127.0.0.1:${port}` };
}

function post(port, body, sessionId) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/z/ZEROHFAKEtestaccesskey000000000/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-claude-code-session-id': sessionId,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

// Owner decision (Astra pre-1.0.0): in `uncertain block` mode too, the proxy
// never refuses a request because the vault can't be saved (a refused
// request ends the session); new values pass and the Stop line says so.
test('the proxy: a vault that cannot save masks only what is on disk, also in block mode, and the pass is shown at Stop', async () => {
  const p = tempProject();
  const token = persistedStripeToken(p);
  // A real turn, with its receipt, as UserPromptSubmit starts it.
  const started = runHook(
    'user-prompt-submit',
    { hook_event_name: 'UserPromptSubmit', prompt: 'read the config' },
    { project: p },
  );
  assert.equal(started.code, 0, started.stderr);
  const ledger = path.join(sessionDir(p.dir, 'test', envOf(p)), 'turn-1.json');
  const previous = process.env.ZEROH_HOME;
  const previousMode = process.env.ZEROH_UNCERTAIN;
  process.env.ZEROH_HOME = p.home;
  process.env.ZEROH_UNCERTAIN = 'block';
  const up = await upstream();
  const proxy = createMaskingProxy({
    resolveUpstream: () => up.url,
    route: () => ({ action: 'mask', root: p.dir }),
  });
  const port = await listen(proxy);
  const restore = await vaultUnsaveable(p);
  try {
    const body = JSON.stringify({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'x',
              content: `STRIPE_KEY=${FAKE_STRIPE}\nGITHUB_TOKEN=${FAKE_GITHUB}`,
            },
          ],
        },
      ],
    });
    assert.equal(await post(port, body, 'test'), 200);
    const sent = up.seen.at(-1);
    assert.ok(sent.includes(token), sent);
    assert.ok(!sent.includes(FAKE_STRIPE));
    assert.ok(sent.includes(FAKE_GITHUB), sent);
    assertRestorable(p, sent, 'proxy');
    const audit = ledgerOf(ledger).audit ?? {};
    assert.ok(audit.unchecked?.['vault-unsaveable']?.proxy >= 1);
  } finally {
    restore();
    proxy.close();
    up.server.close();
    if (previous === undefined) delete process.env.ZEROH_HOME;
    else process.env.ZEROH_HOME = previous;
    if (previousMode === undefined) delete process.env.ZEROH_UNCERTAIN;
    else process.env.ZEROH_UNCERTAIN = previousMode;
  }
  // The proxy can't show a line: the turn's Stop does.
  const stop = runHook(
    'stop',
    { hook_event_name: 'Stop' },
    { project: p, extraEnv: BLOCK },
  );
  assert.equal(stop.code, 0, stop.stderr);
  assert.match(
    stop.json?.systemMessage ?? '',
    /a request to Claude was not protected \(ZeroH couldn't save its vault\)/u,
  );
});

// Astra pre-1.0.0 R5: after a failed vault save the prompt's new value went
// to the provider as typed (the proxy masks only what is on disk), but the
// ledger said `masked_by_proxy`, the Stop line "1 value masked" and "Claude
// saw ⟦…⟧", and the signed summary values_sent 0. What the receipt, the
// ledger and the signed summary say must be what reached the provider.
test('the real proxy after a failed vault save: a value sent as typed is counted as sent, not masked, in the receipt and the signed summary (Astra R5)', async (t) => {
  const p = tempProject();
  const persisted = persistedStripeToken(p);
  const up = await fakeUpstream();
  t.after(() => up.close());
  const env = {
    PATH: process.env.PATH,
    HOME: p.home,
    ZEROH_HOME: p.home,
    ZEROH_CREDENTIAL_HOME: p.home,
    ZEROH_CLAUDE_SETTINGS: p.settings,
    ZEROH_SERVICE_MANAGER_DIR: p.serviceManager,
    TMPDIR: process.env.TMPDIR,
  };
  mkdirSync(path.dirname(p.settings), { recursive: true });
  writeFileSync(
    p.settings,
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: up.url } }),
  );
  const installed = await ensureDefaultProxy({
    env,
    root: p.dir,
    pluginRoot: PLUGIN,
    sessionId: 'test',
  });
  t.after(async () => stopDefaultProxy({ env }));
  const opts = {
    project: p,
    extraEnv: { ZEROH_PROXY: '', ANTHROPIC_BASE_URL: installed.proxyUrl },
  };
  const prompt = `deploy with ${FAKE_STRIPE} and ${FAKE_GITHUB}`;
  const restore = await vaultUnsaveable(p);
  try {
    const submitted = runHook('user-prompt-submit', { prompt }, opts);
    assert.equal(submitted.code, 0, submitted.stderr);
    assert.match(submitted.json.systemMessage, /couldn't save its vault/u);
    const response = await postJson(
      `${installed.proxyUrl}/v1/messages`,
      JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      { sessionId: 'test' },
    );
    assert.equal(response.status, 200);
    const sent = up.seen.at(-1).body;
    assert.ok(sent.includes(FAKE_GITHUB), 'the new value went as typed');
    assert.ok(sent.includes(persisted) && !sent.includes(FAKE_STRIPE));
  } finally {
    restore();
  }
  const stop = runHook('stop', { hook_event_name: 'Stop' }, opts);
  assert.equal(stop.code, 0, stop.stderr);
  const file = path.join(sessionDir(p.dir, 'test', envOf(p)), 'turn-1.json');
  const ledger = ledgerOf(file);
  const summary = turnSummary(ledger);
  // The value on disk was masked; the new one was sent, and says so.
  assert.equal(summary.values_masked, 1, JSON.stringify(summary));
  assert.equal(summary.values_sent, 1, JSON.stringify(summary));
  assert.equal(summary.values_sent_to_ai_provider, true);
  assert.deepEqual(summary.sent_unmasked, {
    count: 1,
    by_type: summary.sent_unmasked.by_type,
  });
  assert.ok(summary.passed_unchecked['vault-unsaveable'] >= 1);
  // The hook's own record survived the ledger write.
  assert.equal(ledger.audit.unchecked['vault-unsaveable'].UserPromptSubmit, 1);
  assert.equal(
    ledger.receipt.public_claims.raw_content_sent_to_ai_provider,
    true,
  );
  assert.equal(
    signedTurnSummary(ledger).summary.values_sent_to_ai_provider,
    true,
  );
  // No "Claude saw" for a token the model never saw.
  const tokens = summary.token_map.map((entry) => entry.token);
  assert.deepEqual(tokens, [persisted]);
  const line = stop.json?.systemMessage ?? '';
  for (const token of line.match(/⟦[^⟧]+⟧/gu) ?? [])
    assert.equal(`[${token.slice(1, -1)}]`, persisted, line);
  const previous = process.env.ZEROH_HOME;
  process.env.ZEROH_HOME = p.home;
  try {
    const verified = await verifyReceiptArtifact(file);
    assert.equal(verified.ok, true, verified.failed?.join(', '));
  } finally {
    if (previous === undefined) delete process.env.ZEROH_HOME;
    else process.env.ZEROH_HOME = previous;
  }
});

// Every mask path saves through lib/restorable.js, never saveQuietly alone
// (which would forward tokens it failed to save).
test('the mask paths save through lib/restorable.js', () => {
  for (const file of ['hooks/post-tool-use.js', 'lib/proxy.js']) {
    const source = readFileSync(path.join(PLUGIN, file), 'utf8');
    assert.doesNotMatch(source, /\bsaveQuietly\(/u, file);
    assert.match(source, /\b(?:saveRestorably|maskRestorably)\(/u, file);
  }
  const pre = readFileSync(path.join(PLUGIN, 'hooks/pre-tool-use.js'), 'utf8');
  assert.match(pre, /\bsaveRestorably\(/u);
});
