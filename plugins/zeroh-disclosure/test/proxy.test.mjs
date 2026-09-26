// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  createMaskingProxy,
  isProxyLoop,
  listen,
  parseProxyTarget,
  scrubBody,
  upstreamTarget,
} from '../lib/proxy.js';
import {
  FAKE_STRIPE,
  PROSE_FIXTURES,
  tempProject,
  withPhoneRegion,
} from './helpers.mjs';
import { createGrant } from '../lib/unmask.js';
import { Vault } from '../lib/vault.js';

// The access key the test proxies accept, and a proxy that masks every
// request with one project's vault unless `route` says otherwise.
const KEY = 'ZEROHFAKEtestaccesskey000000000';
function maskingProxy({ root, upstream, route = null, ...options }) {
  return createMaskingProxy({
    resolveUpstream: (key) => (key === KEY ? upstream : null),
    route: route ?? (() => ({ action: 'mask', root })),
    ...options,
  });
}

function keyed(path) {
  return /^\/(?:v1|api)\//u.test(path) ? `/z/${KEY}${path}` : path;
}

async function fakeUpstream() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: message_start\ndata: {}\n\n');
      res.end('event: message_stop\ndata: {}\n\n');
    });
  });
  const port = await listen(server);
  return { server, seen, url: `http://127.0.0.1:${port}` };
}

async function post(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: keyed(path),
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, data }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('the proxy masks user, tool-result, and system text without changing signed or cacheable fields', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  const up = await fakeUpstream();
  const proxy = maskingProxy({ root: p.dir, upstream: up.url });
  const port = await listen(proxy);
  const body = {
    model: 'claude-sonnet-5',
    system: [
      {
        type: 'text',
        text: `Stable system instructions with ${FAKE_STRIPE}`,
        cache_control: { type: 'ephemeral' },
        signature: `system-signature-${FAKE_STRIPE}`,
      },
    ],
    tools: [
      {
        name: `lookup_${FAKE_STRIPE}`,
        description: `Description ${FAKE_STRIPE}`,
        input_schema: {
          type: 'object',
          properties: { value: { type: 'string', const: FAKE_STRIPE } },
        },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Refund with ${FAKE_STRIPE} for aisha@example.qa`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: `t1-${FAKE_STRIPE}`,
            content: `STRIPE_KEY=${FAKE_STRIPE}`,
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: `signed thought ${FAKE_STRIPE}`,
            signature: `signature-${FAKE_STRIPE}`,
          },
          {
            type: 'redacted_thinking',
            data: `redacted-${FAKE_STRIPE}`,
          },
          {
            type: 'text',
            text: `assistant ${FAKE_STRIPE}`,
            signature: `text-signature-${FAKE_STRIPE}`,
          },
        ],
      },
    ],
  };
  try {
    const res = await post(
      port,
      '/v1/messages?beta=true',
      JSON.stringify(body),
      {
        authorization: 'Bearer test',
        'anthropic-beta': 'oauth-2025-04-20,ZEROHFAKE-capability',
        'anthropic-version': '2023-06-01',
        'x-claude-code-version': 'ZEROHFAKE-2.1.281',
      },
    );
    assert.equal(res.status, 200);
    assert.match(res.data, /message_stop/, 'streamed response passes through');
    const forwarded = up.seen[0];
    assert.equal(forwarded.url, '/v1/messages?beta=true');
    assert.equal(forwarded.headers.authorization, 'Bearer test');
    assert.equal(
      forwarded.headers['anthropic-beta'],
      'oauth-2025-04-20,ZEROHFAKE-capability',
    );
    assert.equal(forwarded.headers['anthropic-version'], '2023-06-01');
    assert.equal(
      forwarded.headers['x-claude-code-version'],
      'ZEROHFAKE-2.1.281',
    );
    const parsed = JSON.parse(forwarded.body);
    assert.ok(!parsed.messages[0].content.includes(FAKE_STRIPE));
    assert.ok(!parsed.messages[0].content.includes('aisha@example.qa'));
    assert.ok(!parsed.messages[1].content[0].content.includes(FAKE_STRIPE));
    assert.ok(!parsed.system[0].text.includes(FAKE_STRIPE));
    assert.deepEqual(
      parsed.system[0].cache_control,
      body.system[0].cache_control,
    );
    assert.equal(parsed.system[0].signature, body.system[0].signature);
    assert.deepEqual(parsed.tools, body.tools);
    assert.equal(
      parsed.messages[1].content[0].tool_use_id,
      body.messages[1].content[0].tool_use_id,
    );
    assert.deepEqual(
      parsed.messages[1].content[0].cache_control,
      body.messages[1].content[0].cache_control,
    );
    // Assistant turns are model output: text is masked too, signed thinking
    // and signatures stay byte-identical.
    assert.deepEqual(
      parsed.messages[2].content[0],
      body.messages[2].content[0],
    );
    assert.deepEqual(
      parsed.messages[2].content[1],
      body.messages[2].content[1],
    );
    assert.equal(
      parsed.messages[2].content[2].signature,
      body.messages[2].content[2].signature,
    );
    assert.ok(!parsed.messages[2].content[2].text.includes(FAKE_STRIPE));
    assert.equal(parsed.model, 'claude-sonnet-5');
  } finally {
    proxy.close();
    up.server.close();
  }
});

test('the proxy never prunes, and a failed vault write never becomes a 502', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  const env = { ...process.env, ZEROH_VAULT_RETENTION: '7d' };
  const seed = new Vault(p.dir, {
    env,
    now: () => Date.now() - 10 * 24 * 60 * 60 * 1000,
  });
  seed.tokenFor('EMAIL', 'zerohfake-old-proxy@example.com', 'detected');
  seed.save();
  const up = await fakeUpstream();
  const proxy = maskingProxy({ root: p.dir, upstream: up.url });
  const port = await listen(proxy);
  const lock = `${seed.file}.lock`;
  try {
    const first = await post(
      port,
      '/v1/messages',
      JSON.stringify({ messages: [{ role: 'user', content: FAKE_STRIPE }] }),
    );
    assert.equal(first.status, 200);
    const after = new Vault(p.dir, { env });
    assert.equal(after.size, 2, 'the old entry survives a proxy save');

    writeFileSync(lock, `${process.pid}\n`);
    const second = await post(
      port,
      '/v1/messages',
      JSON.stringify({
        messages: [
          { role: 'user', content: 'mail zerohfake-new-proxy@example.com' },
        ],
      }),
    );
    assert.equal(second.status, 200);
    assert.ok(!up.seen[1].body.includes('zerohfake-new-proxy@example.com'));
  } finally {
    rmSync(lock, { force: true });
    proxy.close();
    up.server.close();
  }
});

test('the same input masks byte-identically on repeated requests', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  process.env.ZEROH_CLAUDE_SETTINGS = p.settings;
  const up = await fakeUpstream();
  const proxy = maskingProxy({ root: p.dir, upstream: up.url });
  const port = await listen(proxy);
  const request = JSON.stringify({
    system: [{ type: 'text', text: `System ${FAKE_STRIPE}` }],
    messages: [{ role: 'user', content: `User ${FAKE_STRIPE}` }],
  });
  try {
    await post(port, '/v1/messages', request);
    await post(port, '/v1/messages', request);
    assert.equal(up.seen[0].body, up.seen[1].body);
  } finally {
    proxy.close();
    up.server.close();
  }
});

test('the proxy decodes compressed bodies and forwards them uncompressed', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  const up = await fakeUpstream();
  const proxy = maskingProxy({ root: p.dir, upstream: up.url });
  const port = await listen(proxy);
  const gz = zlib.gzipSync(
    JSON.stringify({
      input: [{ role: 'user', content: `key ${FAKE_STRIPE}` }],
    }),
  );
  const res = await post(port, '/v1/responses', gz, {
    'content-encoding': 'gzip',
  });
  assert.equal(res.status, 200);
  assert.equal(up.seen[0].headers['content-encoding'], undefined);
  assert.ok(!up.seen[0].body.includes(FAKE_STRIPE));
  proxy.close();
  up.server.close();
});

test('the proxy applies unmask grants only to the Claude session in the header', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  createGrant({
    root: p.dir,
    home: p.home,
    kind: 'EMAIL',
    reason: 'Match customers across two exports',
    duration: 'session',
    sessionId: 'routed-session',
  });
  const up = await fakeUpstream();
  const proxy = maskingProxy({
    upstream: up.url,
    route: (request) => {
      assert.ok(request.headers['x-claude-code-session-id']);
      return { action: 'mask', root: p.dir };
    },
  });
  const port = await listen(proxy);
  const email = 'aisha@example.qa';
  const phone = '+974 5531 2468';
  const body = JSON.stringify({
    messages: [
      {
        role: 'user',
        content: `email=${email} phone=${phone} key=${FAKE_STRIPE}`,
      },
    ],
  });
  try {
    const res = await post(port, '/v1/messages', body, {
      'x-claude-code-session-id': 'routed-session',
    });
    assert.equal(res.status, 200);
    await post(port, '/v1/messages', body, {
      'x-claude-code-session-id': 'another-session',
    });
    assert.match(up.seen[0].body, /aisha@example\.qa/);
    assert.doesNotMatch(up.seen[0].body, /5531 2468/);
    assert.doesNotMatch(up.seen[0].body, new RegExp(FAKE_STRIPE));
    assert.doesNotMatch(up.seen[1].body, /aisha@example\.qa/);
  } finally {
    proxy.close();
    up.server.close();
  }
});

test('the proxy forwards typed prose with no secret or pattern personal data untouched', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  const up = await fakeUpstream();
  const proxy = maskingProxy({ root: p.dir, upstream: up.url });
  const port = await listen(proxy);
  const body = JSON.stringify({
    messages: PROSE_FIXTURES.map((text) => ({ role: 'user', content: text })),
  });
  try {
    const res = await post(port, '/v1/messages', body);
    assert.equal(res.status, 200);
    assert.equal(up.seen.length, 1);
    assert.deepEqual(
      JSON.parse(up.seen[0].body).messages.map(({ content }) => content),
      PROSE_FIXTURES,
    );
    assert.doesNotMatch(up.seen[0].body, /\[[A-Z_]+-[0-9a-f]{6}\]/);
  } finally {
    proxy.close();
    up.server.close();
  }
});

test('the proxy refuses a body it cannot inspect instead of forwarding it', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  const up = await fakeUpstream();
  const proxy = maskingProxy({ root: p.dir, upstream: up.url });
  const port = await listen(proxy);
  try {
    const res = await post(port, '/v1/messages', '{not json', {});
    // A 4xx with x-should-retry: false: Claude Code must not retry (D-10).
    assert.equal(res.status, 400);
    assert.equal(res.headers['x-should-retry'], 'false');
    assert.equal(up.seen.length, 0);
  } finally {
    proxy.close();
    up.server.close();
  }
});

test('a session the proxy does not mask passes through unchanged and is noted once', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  const up = await fakeUpstream();
  const notices = [];
  const proxy = maskingProxy({
    upstream: up.url,
    route: () => ({ action: 'pass', notice: 'ZEROHFAKE notice' }),
    onInactive: (notice) => notices.push(notice),
  });
  const port = await listen(proxy);
  try {
    const malformed = '{ZEROHFAKE not json';
    const first = await post(port, '/v1/messages', malformed);
    const second = await post(port, '/v1/messages', malformed);
    assert.equal(first.status, 200);
    assert.equal(
      first.headers['x-zeroh-disclosure'],
      'passthrough-plugin-inactive',
    );
    assert.equal(second.headers['x-zeroh-disclosure'], undefined);
    assert.equal(up.seen[0].body, malformed);
    assert.equal(up.seen[1].body, malformed);
    assert.deepEqual(notices, ['ZEROHFAKE notice']);
  } finally {
    proxy.close();
    up.server.close();
  }
});

test('the proxy passes named-token brackets through unchanged', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  const up = await fakeUpstream();
  const proxy = maskingProxy({ root: p.dir, upstream: up.url });
  const port = await listen(proxy);
  const named = '⟦API_KEY-3f9a1c⟧';
  try {
    const res = await post(
      port,
      '/v1/messages',
      JSON.stringify({ messages: [{ role: 'user', content: named }] }),
    );
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(up.seen[0].body).messages[0].content, named);
  } finally {
    proxy.close();
    up.server.close();
  }
});

test('loop detection recognises the proxy own loopback listener', () => {
  assert.equal(
    isProxyLoop('http://localhost:8787', {
      host: '127.0.0.1',
      port: 8787,
    }),
    true,
  );
  assert.equal(
    isProxyLoop('http://127.0.0.1:8788', {
      host: '127.0.0.1',
      port: 8787,
    }),
    false,
  );
  // One loopback rule everywhere: IPv6, 127/8 and 0.0.0.0 are this machine
  // too (the copies used to disagree on [::1]).
  for (const url of [
    'http://[::1]:8787',
    'http://127.0.0.2:8787',
    'http://0.0.0.0:8787',
  ]) {
    assert.equal(isProxyLoop(url, { port: 8787 }), true, url);
  }
});

test('scrubBody uses the prompt rules for typed text and the tool rules for tool output', async () => {
  const { scrubBody } = await import('../lib/proxy.js');
  const { Vault } = await import('../lib/vault.js');
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-profile-'));
  try {
    const vault = new Vault(root);
    const body = {
      system: 'Merged Pull Request into Main Branch',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: 'Build Succeeded For Pull Request',
            },
            { type: 'text', text: 'Please call Jonathan Smith on 5512 3456' },
          ],
        },
      ],
    };
    const out = withPhoneRegion('QA', () =>
      scrubBody(body, { vault, known: [], profile: 'prompt' }),
    );
    assert.equal(out.system, 'Merged Pull Request into Main Branch');
    assert.equal(
      out.messages[0].content[0].content,
      'Build Succeeded For Pull Request',
    );
    assert.match(
      out.messages[0].content[1].text,
      /^Please call Jonathan Smith on \[PHONE_NUMBER-[0-9a-f]{6}\]/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a typed secret gets one value-free note naming its provider', async () => {
  const { scrubBody, typedMaskNote } = await import('../lib/proxy.js');
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-note-'));
  try {
    const vault = new Vault(root);
    const body = {
      messages: [
        { role: 'user', content: 'hello there' },
        { role: 'assistant', content: 'hi' },
        {
          role: 'user',
          content: [
            { type: 'text', text: `my key is ${FAKE_STRIPE}, what provider?` },
            {
              type: 'text',
              text: `<system-reminder>env ${FAKE_STRIPE}</system-reminder>`,
            },
          ],
        },
      ],
    };
    const out = scrubBody(body, { vault, known: [], profile: 'prompt' });
    const text = out.messages[2].content[0].text;
    const token = text.match(/\[API_KEY-[0-9a-f]{6}\]/u)[0];
    const note = `(ZeroH Disclosure masked 1 value the user typed: ${token} is a Stripe live secret key. The user's screen shows the real value wherever you write ${token}; to name the token itself, write ⟦${token.slice(1, -1)}⟧.)`;
    assert.equal(text, `my key is ${token}, what provider?\n\n${note}`);
    assert.ok(!JSON.stringify(out).includes(FAKE_STRIPE));
    assert.ok(
      !note.includes('ZEROHFAKE'),
      'the note holds no part of the value',
    );
    assert.doesNotMatch(
      out.messages[2].content[1].text,
      /ZeroH Disclosure masked/u,
    );
    assert.deepEqual(out.messages[0], body.messages[0]);
    assert.equal(
      typedMaskNote([token], { labelFor: () => 'Stripe live secret key' }),
      note,
    );
    assert.equal(
      JSON.stringify(scrubBody(body, { vault, known: [], profile: 'prompt' })),
      JSON.stringify(out),
      'the same input gives the same output',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the typed-value note goes only on the latest typed message, never on tool results', async () => {
  const { scrubBody } = await import('../lib/proxy.js');
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-note-'));
  try {
    const vault = new Vault(root);
    const older = { role: 'user', content: `old key ${FAKE_STRIPE}` };
    const latest = { role: 'user', content: 'mail aisha@example.qa please' };
    const toolLoop = {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: `STRIPE_KEY=${FAKE_STRIPE}`,
        },
      ],
    };
    const body = {
      messages: [older, { role: 'assistant', content: 'ok' }, latest, toolLoop],
    };
    const out = scrubBody(body, { vault, known: [], profile: 'prompt' });
    assert.doesNotMatch(out.messages[0].content, /ZeroH Disclosure masked/u);
    assert.match(
      out.messages[2].content,
      /\n\n\(ZeroH Disclosure masked 1 value the user typed: \[EMAIL-[0-9a-f]{6}\] is a value of type EMAIL\. /u,
    );
    assert.doesNotMatch(
      JSON.stringify(out.messages[3]),
      /ZeroH Disclosure masked/u,
    );
    assert.doesNotMatch(JSON.stringify(out), /aisha@example\.qa/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a noted message keeps its note when the history is resent on a later turn', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  const up = await fakeUpstream();
  const proxy = maskingProxy({ root: p.dir, upstream: up.url });
  const port = await listen(proxy);
  const first = { role: 'user', content: `my key is ${FAKE_STRIPE}` };
  const turnOne = { messages: [first] };
  const turnTwo = {
    messages: [
      first,
      { role: 'assistant', content: 'noted' },
      { role: 'user', content: 'thanks, nothing secret here' },
    ],
  };
  try {
    await post(port, '/v1/messages', JSON.stringify(turnOne));
    await post(port, '/v1/messages', JSON.stringify(turnOne));
    await post(port, '/v1/messages', JSON.stringify(turnTwo));
    assert.equal(up.seen[0].body, up.seen[1].body, 'a retry is byte-identical');
    const one = JSON.parse(up.seen[0].body).messages;
    const two = JSON.parse(up.seen[2].body).messages;
    assert.equal(two[0].content, one[0].content, 'the old note is stable');
    assert.equal(
      one[0].content.split('ZeroH Disclosure masked').length,
      2,
      'exactly one note',
    );
    assert.equal(two[2].content, 'thanks, nothing secret here');
    assert.ok(!up.seen.some(({ body }) => body.includes(FAKE_STRIPE)));
  } finally {
    proxy.close();
    up.server.close();
  }
});

test('provider labels come from the fixed prefix catalog, else the type', async () => {
  const { providerLabel } = await import('../lib/detector.js');
  assert.equal(providerLabel(FAKE_STRIPE), 'Stripe live secret key');
  assert.equal(
    providerLabel('ghp_ZEROHFAKE000000000000000000000000000'),
    'GitHub personal access token',
  );
  assert.equal(providerLabel('ZEROHFAKE-plain-password'), null);
  assert.equal(providerLabel(''), null);
});

test('request targets must be origin-form API paths on the upstream', () => {
  for (const raw of [
    'http://127.0.0.1:9/v1/messages',
    'https://evil.zerohfake.invalid/v1/messages',
    '//evil.zerohfake.invalid/v1/messages',
    '/\\evil.zerohfake.invalid/v1/messages',
    '*',
    '',
  ]) {
    assert.throws(() => parseProxyTarget(raw), /origin-form/u, raw);
  }
  for (const off of ['/etc/passwd', '/backend-api/codex/responses']) {
    assert.throws(
      () => parseProxyTarget(`/z/ZEROHFAKEkey0000000000000000${off}`),
      /API paths/u,
    );
  }
  // No key: the owner decides (the daemon forwards to a known upstream).
  assert.equal(parseProxyTarget('/v1/messages').key, null);
  const target1 = parseProxyTarget(
    '/z/ZEROHFAKEkey0000000000000000/v1/messages?beta=true',
  );
  assert.equal(target1.key, 'ZEROHFAKEkey0000000000000000');
  assert.equal(target1.pathname, '/v1/messages');
  const target = upstreamTarget('https://gateway.zerohfake.invalid/anthropic', {
    pathname: '/v1/../v1/messages',
    search: '?beta=true',
  });
  assert.equal(target.host, 'gateway.zerohfake.invalid');
  assert.equal(target.pathname, '/anthropic/v1/messages');
});

test('the generic proxy forwards only what its owner resolves to an upstream', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  const up = await fakeUpstream();
  const proxy = maskingProxy({ root: p.dir, upstream: up.url });
  const port = await listen(proxy);
  try {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: 'hi' }],
    });
    const offPath = await post(port, '/zeroh/v1/messages', body);
    assert.equal(offPath.status, 404);
    assert.equal(offPath.headers['x-should-retry'], 'false');
    assert.equal(
      (
        await post(
          port,
          '/z/ZEROHFAKEwrongkey000000000000000/v1/messages',
          body,
        )
      ).status,
      403,
    );
    assert.equal(up.seen.length, 0);
    const ok = await post(port, '/v1/messages', body);
    assert.equal(ok.status, 200);
    assert.equal(up.seen[0].url, '/v1/messages');
  } finally {
    proxy.close();
    up.server.close();
  }
});

test('non-JSON bodies are refused, never forwarded raw', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  const up = await fakeUpstream();
  const proxy = maskingProxy({ root: p.dir, upstream: up.url });
  const port = await listen(proxy);
  try {
    const res = await post(port, '/v1/messages', `key ${FAKE_STRIPE}`, {
      'content-type': 'text/plain',
    });
    assert.equal(res.status, 415);
    assert.equal(up.seen.length, 0);
  } finally {
    proxy.close();
    up.server.close();
  }
});

test('documents, assistant turns and large strings are masked or refused', () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  const vault = new Vault(p.dir);
  const opts = { vault, known: [], profile: 'prompt' };
  const out = scrubBody(
    {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              title: `notes ${FAKE_STRIPE}`,
              source: {
                type: 'text',
                media_type: 'text/plain',
                data: `k=${FAKE_STRIPE}`,
              },
            },
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'text/plain',
                data: Buffer.from(`k=${FAKE_STRIPE}`).toString('base64'),
              },
            },
            {
              type: 'document',
              source: {
                type: 'content',
                content: [{ type: 'text', text: `inner ${FAKE_STRIPE}` }],
              },
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgo=',
              },
            },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: `I used ${FAKE_STRIPE}` },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Bash',
              input: { command: `curl -H "Bearer ${FAKE_STRIPE}"` },
            },
          ],
        },
      ],
    },
    opts,
  );
  const text = JSON.stringify(out);
  assert.ok(!text.includes(FAKE_STRIPE));
  const decoded = Buffer.from(
    out.messages[0].content[1].source.data,
    'base64',
  ).toString('utf8');
  assert.ok(!decoded.includes(FAKE_STRIPE));
  assert.equal(out.messages[0].content[3].source.data, 'iVBORw0KGgo=');
  assert.equal(out.messages[1].content[1].id, 'toolu_1');
  assert.throws(
    () =>
      scrubBody(
        { messages: [{ role: 'user', content: 'x'.repeat(17 * 1024 * 1024) }] },
        opts,
      ),
    /too large to inspect/u,
  );
});

test('a client that disconnects aborts the upstream request, and an upstream reset ends the client', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  let upstreamClosed = null;
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: ping\ndata: {}\n\n');
      if (req.url.includes('reset')) {
        setTimeout(() => res.socket.destroy(), 50);
        return;
      }
      const timer = setInterval(
        () => res.write('event: ping\ndata: {}\n\n'),
        20,
      );
      res.on('close', () => {
        clearInterval(timer);
        upstreamClosed = Date.now();
      });
    });
  });
  const upPort = await listen(upstream);
  const proxy = maskingProxy({
    root: p.dir,
    upstream: `http://127.0.0.1:${upPort}`,
  });
  const port = await listen(proxy);
  try {
    const body = JSON.stringify({
      messages: [{ role: 'user', content: 'hi' }],
    });
    const aborted = Date.now();
    await new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: keyed('/v1/messages'),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      req.on('response', (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', () => {});
      req.end(body);
    });
    for (let i = 0; i < 50 && upstreamClosed === null; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(upstreamClosed !== null, 'upstream request kept running');
    assert.ok(upstreamClosed - aborted < 1000);

    const ended = await new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: keyed('/v1/messages?reset=1'),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      req.on('response', (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve('end'));
        res.on('error', () => resolve('error'));
        res.on('aborted', () => resolve('aborted'));
      });
      req.on('error', () => resolve('error'));
      req.end(body);
      setTimeout(() => resolve('hung'), 3000);
    });
    assert.notEqual(ended, 'hung');
  } finally {
    proxy.close();
    upstream.close();
  }
});

// D-10: an error the proxy produces never makes Claude Code retry. A
// network failure on the way to the upstream is retryable, as it would be
// without ZeroH (LP-F1), and still answers at once.
test('an unreachable upstream fails fast and retryably; an upstream loop fails non-retryably', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  const closed = http.createServer();
  const deadPort = await listen(closed);
  await new Promise((resolve) => closed.close(resolve));
  const key = 'ZEROHFAKEloopkey0000000000';
  let proxyPort = 0;
  const proxy = createMaskingProxy({
    root: p.dir,
    resolveUpstream: (candidate) =>
      candidate === key
        ? `http://127.0.0.1:${proxyPort}`
        : `http://127.0.0.1:${deadPort}`,
    route: () => ({ action: 'pass', quiet: true }),
  });
  proxyPort = await listen(proxy);
  const body = JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] });
  try {
    const started = Date.now();
    const down = await post(
      proxyPort,
      '/z/ZEROHFAKEdeadkey000000000/v1/messages',
      body,
    );
    assert.ok(Date.now() - started < 2_000);
    assert.equal(down.status, 502);
    assert.equal(down.headers['x-should-retry'], 'true');
    const downError = JSON.parse(down.data);
    assert.equal(downError.type, 'error');
    assert.equal(downError.error.type, 'api_error');
    assert.match(downError.error.message, /can't reach 127\.0\.0\.1:\d+/u);
    assert.match(downError.error.message, /ECONNREFUSED/u);

    const loop = await post(proxyPort, `/z/${key}/v1/messages`, body);
    assert.equal(loop.status, 400);
    assert.equal(loop.headers['x-should-retry'], 'false');
    assert.match(
      JSON.parse(loop.data).error.message,
      /points back at the proxy itself/u,
    );

    const unknown = createMaskingProxy({
      root: p.dir,
      resolveUpstream: () => null,
      route: () => ({ action: 'pass', quiet: true }),
    });
    const unknownPort = await listen(unknown);
    try {
      const missing = await post(
        unknownPort,
        '/z/ZEROHFAKEnorecord00000000/v1/messages',
        body,
      );
      assert.equal(missing.status, 403);
      assert.equal(missing.headers['x-should-retry'], 'false');
      assert.match(
        JSON.parse(missing.data).error.message,
        /forwards only to its upstream/u,
      );
    } finally {
      unknown.close();
    }
  } finally {
    proxy.close();
  }
});

// Sleep and network changes leave kept-alive upstream connections stale.
test('a request that meets a stale kept-alive upstream connection is sent once more', async () => {
  const p = tempProject();
  process.env.ZEROH_HOME = p.home;
  let requests = 0;
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      requests += 1;
      if (req.socket.zerohServed) {
        req.socket.destroy();
        return;
      }
      req.socket.zerohServed = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  const upPort = await listen(upstream);
  const proxy = maskingProxy({
    root: p.dir,
    upstream: `http://127.0.0.1:${upPort}`,
  });
  const port = await listen(proxy);
  const body = JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] });
  try {
    assert.equal((await post(port, '/v1/messages', body)).status, 200);
    assert.equal((await post(port, '/v1/messages', body)).status, 200);
    assert.equal(requests, 3);
  } finally {
    proxy.close();
    upstream.close();
  }
});
