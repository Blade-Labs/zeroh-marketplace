// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import { callMcpTool, mcpClient } from './helpers.mjs';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  claimUnmaskMcpSession,
  createGrant,
  readGrantStore,
  writeCap,
} from '../lib/unmask.js';

const SERVER = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));

test('the plugin-root MCP manifest declares the bundled server', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(manifest.mcpServers['zeroh-disclosure'], {
    command: 'node',
    args: ['${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs'],
  });
  assert.equal(existsSync(SERVER), true);
});

function fixture() {
  return {
    root: mkdtempSync(path.join(os.tmpdir(), 'zeroh-mcp-project-')),
    home: mkdtempSync(path.join(os.tmpdir(), 'zeroh-mcp-home-')),
  };
}

function client({ root, home, elicitation = true, entrypoint = null }) {
  return mcpClient({
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      ZEROH_HOME: home,
      CLAUDE_SESSION_ID: 'mcp-test-session',
    },
    elicitation,
    entrypoint,
  });
}

function callTool(instance, id, arguments_) {
  return callMcpTool(instance, id, 'request_unmask', arguments_);
}

test('request_unmask refuses headless clients and secrets without eliciting', async (t) => {
  const headlessFixture = fixture();
  const headless = client({ ...headlessFixture, elicitation: false });
  t.after(() => headless.stop());
  await headless.ready;
  const refused = await callTool(headless, 2, {
    kind: 'EMAIL',
    reason: 'Inspect a fake record',
  });
  assert.match(
    refused.result.content[0].text,
    /interactive Claude Code session/u,
  );
  assert.deepEqual(
    readGrantStore(headlessFixture.root, headlessFixture.home).grants,
    [],
  );

  const printFixture = fixture();
  const printMode = client({
    ...printFixture,
    elicitation: true,
    entrypoint: 'sdk-cli',
  });
  t.after(() => printMode.stop());
  await printMode.ready;
  const printRefusal = await callTool(printMode, 7, {
    kind: 'EMAIL',
    reason: 'Inspect a fake record',
  });
  assert.match(
    printRefusal.result.content[0].text,
    /interactive Claude Code session/u,
  );
  assert.deepEqual(
    readGrantStore(printFixture.root, printFixture.home).grants,
    [],
  );

  const secretFixture = fixture();
  const secret = client(secretFixture);
  t.after(() => secret.stop());
  await secret.ready;
  const secretResult = await callTool(secret, 3, {
    kind: 'API_KEY',
    reason: 'Try to inspect a fake key',
  });
  assert.match(secretResult.result.content[0].text, /never unmasked/u);
  assert.deepEqual(
    readGrantStore(secretFixture.root, secretFixture.home).grants,
    [],
  );
});

test('request_unmask filters cap options and grants only an explicit accept', async (t) => {
  const acceptedFixture = fixture();
  writeCap('EMAIL', '15m', { home: acceptedFixture.home });
  const accepted = client(acceptedFixture);
  t.after(() => accepted.stop());
  await accepted.ready;
  const responsePromise = callTool(accepted, 2, {
    kind: 'EMAIL',
    reason: 'Match customers across two exports',
  });
  const elicitation = await accepted.next(
    (message) => message.method === 'elicitation/create',
  );
  const duration = elicitation.params.requestedSchema.properties.duration;
  assert.deepEqual(duration.enum, ['15 minutes']);
  assert.match(elicitation.params.message, /limited by your cap for EMAIL/u);
  // T-21: preselected, so Enter accepts; the title says how to change it.
  assert.equal(duration.default, '15 minutes');
  assert.match(duration.title, /→ to change/u);
  accepted.send({
    jsonrpc: '2.0',
    id: elicitation.id,
    result: { action: 'accept', content: { duration: '15 minutes' } },
  });
  const response = await responsePromise;
  assert.match(
    response.result.content[0].text,
    /EMAIL unmasked for 15 minutes/u,
  );
  assert.equal(
    readGrantStore(acceptedFixture.root, acceptedFixture.home).grants.length,
    1,
  );

  for (const action of ['decline', 'cancel']) {
    const declinedFixture = fixture();
    const declined = client(declinedFixture);
    t.after(() => declined.stop());
    await declined.ready;
    const declinedPromise = callTool(declined, 4, {
      kind: 'EMAIL',
      reason: 'Inspect a fake email',
    });
    const prompt = await declined.next(
      (message) => message.method === 'elicitation/create',
    );
    // T-32: the default cap offers all three, and says nothing of a cap.
    assert.deepEqual(prompt.params.requestedSchema.properties.duration.enum, [
      '15 minutes',
      '1 hour',
      'Until the session ends',
    ]);
    assert.doesNotMatch(prompt.params.message, /cap/u);
    assert.equal(
      prompt.params.requestedSchema.properties.duration.default,
      '15 minutes',
    );
    declined.send({
      jsonrpc: '2.0',
      id: prompt.id,
      result: { action },
    });
    const answer = await declinedPromise;
    assert.match(answer.result.content[0].text, /user declined/u);
    assert.deepEqual(
      readGrantStore(declinedFixture.root, declinedFixture.home).grants,
      [],
    );
  }
});

test('request_unmask refuses a zero cap without eliciting', async (t) => {
  const disabledFixture = fixture();
  writeCap('IBAN', '0', { home: disabledFixture.home });
  const disabled = client(disabledFixture);
  t.after(() => disabled.stop());
  await disabled.ready;
  const response = await callTool(disabled, 8, {
    kind: 'IBAN',
    reason: 'Inspect a fake account',
  });
  assert.match(response.result.content[0].text, /disabled by the user's cap/u);
  assert.deepEqual(
    readGrantStore(disabledFixture.root, disabledFixture.home).grants,
    [],
  );
});

test('a cap lowered during elicitation prevents the accepted grant', async (t) => {
  const changedFixture = fixture();
  const instance = client(changedFixture);
  t.after(() => instance.stop());
  await instance.ready;
  const responsePromise = callTool(instance, 10, {
    kind: 'EMAIL',
    reason: 'Inspect a fake email',
  });
  const prompt = await instance.next(
    (message) => message.method === 'elicitation/create',
  );
  writeCap('EMAIL', '0', { home: changedFixture.home });
  instance.send({
    jsonrpc: '2.0',
    id: prompt.id,
    result: { action: 'accept', content: { duration: '1 hour' } },
  });
  const response = await responsePromise;
  assert.match(response.result.content[0].text, /cap changed/u);
  assert.deepEqual(
    readGrantStore(changedFixture.root, changedFixture.home).grants,
    [],
  );
});

test('a session grant binds to the current hook session, not inherited environment', async (t) => {
  const sessionFixture = fixture();
  writeCap('EMAIL', 'session', { home: sessionFixture.home });
  claimUnmaskMcpSession(sessionFixture.root, 'current-hook-session', {
    home: sessionFixture.home,
  });
  const instance = client(sessionFixture);
  t.after(() => instance.stop());
  await instance.ready;
  const responsePromise = callTool(instance, 9, {
    kind: 'EMAIL',
    reason: 'Match customers across two exports',
  });
  const prompt = await instance.next(
    (message) => message.method === 'elicitation/create',
  );
  instance.send({
    jsonrpc: '2.0',
    id: prompt.id,
    result: {
      action: 'accept',
      content: { duration: 'Until the session ends' },
    },
  });
  await responsePromise;
  assert.equal(
    readGrantStore(sessionFixture.root, sessionFixture.home).grants[0]
      .session_id,
    'current-hook-session',
  );
});

// T-33: the model ends grants without a dialog, even headless; it can never
// create or extend one this way.
test('end_unmask ends grants without a dialog and never creates one', async (t) => {
  const endFixture = fixture();
  createGrant({
    root: endFixture.root,
    home: endFixture.home,
    kind: 'EMAIL',
    reason: 'Inspect a fake row',
    duration: '15m',
  });
  const instance = client({ ...endFixture, elicitation: false });
  t.after(() => instance.stop());
  await instance.ready;
  instance.send({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
  const list = await instance.next((message) => message.id === 3);
  const tool = list.result.tools.find(({ name }) => name === 'end_unmask');
  assert.deepEqual(tool.inputSchema.required, ['kind']);
  assert.ok(tool.inputSchema.properties.kind.enum.includes('all'));
  assert.equal(
    Object.keys(tool.inputSchema.properties).join(','),
    'kind',
    'no duration: it cannot extend a grant',
  );
  const ended = await callMcpTool(instance, 4, 'end_unmask', { kind: 'EMAIL' });
  assert.equal(
    ended.result.content[0].text,
    'EMAIL masked again: the unmask ended.',
  );
  const none = await callMcpTool(instance, 5, 'end_unmask', { kind: 'all' });
  assert.match(none.result.content[0].text, /No unmask is active/u);
  const store = readGrantStore(endFixture.root, endFixture.home);
  assert.deepEqual(store.grants, []);
  assert.equal(store.receipts.at(-1).action, 'revoke');
});
