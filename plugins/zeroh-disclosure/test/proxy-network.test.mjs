// SPDX-License-Identifier: AGPL-3.0-only

// The daemon reaches its upstream through the user's network (LP-B1): a
// corporate CONNECT proxy and a TLS-inspecting CA, also after a "reboot"
// (the daemon started by its login item, with none of the shell's
// variables). Network failures are retryable, everything else final
// (LP-F1). Fake certificates and a fake proxy on loopback only.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { bypassesProxy, networkEnvironment, proxyFor } from '../lib/network.js';
import {
  ensureDefaultProxy,
  probeProxy,
  stopDefaultProxy,
} from '../lib/proxy-manager.js';
import { upstreamFailure } from '../lib/proxy.js';
import { proxyPaths, readProxyConfig } from '../lib/proxy-state.js';
import {
  isolatedProxyEnvironment as isolatedEnvironment,
  PLUGIN,
  postJson,
} from './helpers.mjs';

const HAS_OPENSSL =
  spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;
const UPSTREAM_HOST = 'zeroh-upstream.invalid';
const BODY = JSON.stringify({
  messages: [{ role: 'user', content: 'ZEROHFAKE network request' }],
});

// A throwaway CA and a server certificate for the fake upstream host.
function certificates(dir) {
  mkdirSync(dir, { recursive: true });
  const run = (args) => {
    const result = spawnSync('openssl', args, { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
  };
  run([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '2',
    '-subj',
    '/CN=ZeroH Fake Corporate CA',
    '-keyout',
    'ca.key',
    '-out',
    'ca.pem',
  ]);
  run([
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    `/CN=${UPSTREAM_HOST}`,
    '-keyout',
    'server.key',
    '-out',
    'server.csr',
  ]);
  writeFileSync(
    path.join(dir, 'ext'),
    `subjectAltName=DNS:${UPSTREAM_HOST},DNS:localhost\n`,
  );
  run([
    'x509',
    '-req',
    '-in',
    'server.csr',
    '-CA',
    'ca.pem',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-days',
    '2',
    '-extfile',
    'ext',
    '-out',
    'server.pem',
  ]);
  return {
    ca: path.join(dir, 'ca.pem'),
    key: readFileSync(path.join(dir, 'server.key')),
    cert: readFileSync(path.join(dir, 'server.pem')),
  };
}

function listenOn(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
}

// A TLS upstream and a corporate proxy that tunnels every CONNECT to it.
async function corporateNetwork(t, root) {
  const tlsFiles = certificates(path.join(root, 'tls'));
  const seen = [];
  const upstream = https.createServer(
    { key: tlsFiles.key, cert: tlsFiles.cert },
    (request, response) => {
      request.resume();
      request.on('end', () => {
        seen.push(request.url);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
      });
    },
  );
  const upstreamPort = await listenOn(upstream);
  const tunnels = [];
  const proxy = http.createServer((_request, response) => {
    response.writeHead(405);
    response.end();
  });
  proxy.on('connect', (request, socket, head) => {
    tunnels.push(request.url);
    const target = net.connect(upstreamPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      target.write(head);
      target.pipe(socket);
      socket.pipe(target);
    });
    target.on('error', () => socket.destroy());
    socket.on('error', () => target.destroy());
  });
  const proxyPort = await listenOn(proxy);
  t.after(() => {
    upstream.closeAllConnections?.();
    upstream.close();
    proxy.closeAllConnections?.();
    proxy.close();
  });
  return {
    upstreamUrl: `https://${UPSTREAM_HOST}:${upstreamPort}`,
    network: {
      HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
      NO_PROXY: 'localhost,127.0.0.1',
      NODE_EXTRA_CA_CERTS: tlsFiles.ca,
    },
    seen,
    tunnels,
  };
}

function killDaemon(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test('NO_PROXY and the proxy choice follow the usual rules', () => {
  const network = {
    HTTPS_PROXY: 'http://corp.example.com:3128',
    NO_PROXY: '.internal.example.com, api.example.org:8443',
  };
  assert.equal(
    proxyFor(new URL('https://api.anthropic.com'), network)?.host,
    'corp.example.com:3128',
  );
  assert.equal(proxyFor(new URL('http://127.0.0.1:9/x'), network), null);
  assert.equal(
    bypassesProxy(new URL('https://llm.internal.example.com'), network),
    true,
  );
  assert.equal(
    bypassesProxy(new URL('https://api.example.org:8443'), network),
    true,
  );
  assert.equal(
    bypassesProxy(new URL('https://api.example.org'), network),
    false,
  );
  assert.equal(proxyFor(new URL('http://api.example.org'), network), null);
  assert.deepEqual(
    Object.keys(
      networkEnvironment({ HTTPS_PROXY: ' ', no_proxy: 'x', PATH: 'y' }),
    ),
    ['no_proxy'],
  );
});

test(
  'a corporate proxy and CA keep working after a reboot, and a changed network restarts the daemon (LP-B1)',
  {
    skip: HAS_OPENSSL ? false : 'openssl is not installed',
  },
  async (t) => {
    const isolated = isolatedEnvironment('network');
    const corp = await corporateNetwork(t, isolated.root);
    writeFileSync(
      isolated.settings,
      `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: corp.upstreamUrl } })}\n`,
    );
    const env = { ...isolated.env, ...corp.network };
    t.after(async () => stopDefaultProxy({ env }));
    const installed = await ensureDefaultProxy({
      env,
      root: isolated.root,
      pluginRoot: PLUGIN,
      sessionId: 'net-1',
    });
    assert.equal(installed.upstream, corp.upstreamUrl);
    const config = readProxyConfig(proxyPaths(env));
    assert.equal(config.environment.HTTPS_PROXY, corp.network.HTTPS_PROXY);
    assert.equal(
      config.environment.NODE_EXTRA_CA_CERTS,
      corp.network.NODE_EXTRA_CA_CERTS,
    );

    const day1 = await postJson(`${installed.proxyUrl}/v1/messages`, BODY, {
      sessionId: 'net-1',
    });
    assert.equal(day1.status, 200, day1.text);
    assert.equal(corp.tunnels.length, 1);

    // Reboot: the daemon dies and the login item starts it with a login
    // environment (no proxy, no CA variable).
    killDaemon(installed.pid);
    const paths = proxyPaths(env);
    await waitFor(
      async () => !(await probeProxy(`http://127.0.0.1:${config.port}`)),
    );
    const loginItem = spawn(
      process.execPath,
      [path.join(paths.runtime, 'bin', 'proxy-daemon.mjs'), paths.config],
      {
        env: { PATH: process.env.PATH, HOME: isolated.env.HOME },
        stdio: 'ignore',
        detached: true,
      },
    );
    loginItem.unref();
    t.after(() => killDaemon(loginItem.pid));
    assert.ok(
      await waitFor(() => probeProxy(`http://127.0.0.1:${config.port}`)),
      'the login item started the daemon',
    );
    const afterReboot = await postJson(
      `${installed.proxyUrl}/v1/messages`,
      BODY,
      {
        sessionId: 'net-1',
      },
    );
    assert.equal(afterReboot.status, 200, afterReboot.text);
    assert.equal(corp.tunnels.length, 2, 'the request went through the proxy');
    assert.equal(corp.seen.length, 2);

    // A session with no network variables keeps the recorded ones; a session
    // with different ones restarts the daemon with them.
    const plain = await ensureDefaultProxy({
      env: isolated.env,
      root: isolated.root,
      pluginRoot: PLUGIN,
      sessionId: 'net-2',
    });
    assert.equal(plain.pid, loginItem.pid, 'no restart for an empty network');
    const moved = await ensureDefaultProxy({
      env: { ...env, NO_PROXY: `${UPSTREAM_HOST},localhost` },
      root: isolated.root,
      pluginRoot: PLUGIN,
      sessionId: 'net-3',
    });
    assert.notEqual(moved.pid, loginItem.pid, 'a changed network restarts it');
    assert.equal(
      readProxyConfig(paths).environment.NO_PROXY,
      `${UPSTREAM_HOST},localhost`,
    );
  },
);

test('a recorded network proxy that cannot be reached is dropped, not a 502 for good (F-2)', async (t) => {
  const isolated = isolatedEnvironment('network-gone');
  // Another network's proxy: nothing listens on its port any more.
  const gone = net.createServer();
  const gonePort = await listenOn(gone);
  await new Promise((resolve) => gone.close(resolve));
  const upstreamUrl = `http://${UPSTREAM_HOST}:9`;
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: upstreamUrl } })}\n`,
  );
  const office = { HTTP_PROXY: `http://127.0.0.1:${gonePort}` };
  const env = { ...isolated.env, ...office };
  t.after(async () => stopDefaultProxy({ env }));
  const installed = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'gone-1',
  });
  const paths = proxyPaths(env);
  assert.equal(
    readProxyConfig(paths).environment.HTTP_PROXY,
    office.HTTP_PROXY,
  );

  const first = await postJson(`${installed.proxyUrl}/v1/messages`, BODY, {
    sessionId: 'gone-1',
  });
  assert.equal(first.status, 502);
  assert.match(first.text, /ECONNREFUSED/u);
  // Dropped in the daemon and in proxy.json: Claude Code's retry goes
  // direct (here the fake upstream name does not resolve, so the error
  // changes; on a real network the request goes through).
  assert.ok(
    await waitFor(
      () => readProxyConfig(paths).environment.HTTP_PROXY === undefined,
    ),
  );
  const retry = await postJson(`${installed.proxyUrl}/v1/messages`, BODY, {
    sessionId: 'gone-1',
  });
  assert.equal(retry.status, 502);
  assert.doesNotMatch(retry.text, /ECONNREFUSED/u);
  assert.equal(readProxyConfig(paths).environment.HOME, env.HOME);

  // A session that names a proxy records it again, and the daemon follows.
  const again = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'gone-2',
  });
  assert.notEqual(again.pid, installed.pid);
  assert.equal(
    readProxyConfig(paths).environment.HTTP_PROXY,
    office.HTTP_PROXY,
  );
});

test('network failures are retryable; certificates and refusals are final and say what to do (LP-F1)', () => {
  const refused = Object.assign(new Error('connect ECONNREFUSED'), {
    code: 'ECONNREFUSED',
  });
  const network = upstreamFailure('https://api.anthropic.com', refused);
  assert.equal(network.status, 502);
  assert.equal(network.retry, true);
  assert.match(network.message, /Claude Code retries/u);

  for (const code of ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN']) {
    assert.equal(
      upstreamFailure('https://api.anthropic.com', { code }).retry,
      true,
      code,
    );
  }
  const certificate = upstreamFailure('https://api.anthropic.com', {
    code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  });
  assert.equal(certificate.status, 400);
  assert.equal(certificate.retry, false);
  assert.match(certificate.message, /NODE_EXTRA_CA_CERTS/u);
  const password = upstreamFailure('https://api.anthropic.com', {
    code: 'ZEROH_PROXY_CONNECT',
    status: 407,
  });
  assert.equal(password.retry, false);
  assert.match(password.message, /asks for a password/u);
});

test(
  'an unreachable upstream answers 502 with retry allowed; a TLS failure is final (LP-F1)',
  {
    skip: HAS_OPENSSL ? false : 'openssl is not installed',
  },
  async (t) => {
    const isolated = isolatedEnvironment('network-errors');
    const corp = await corporateNetwork(t, isolated.root);
    // A closed port: a network failure.
    const closed = net.createServer();
    const closedPort = await listenOn(closed);
    await new Promise((resolve) => closed.close(resolve));
    writeFileSync(
      isolated.settings,
      `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${closedPort}` } })}\n`,
    );
    const env = { ...isolated.env };
    t.after(async () => stopDefaultProxy({ env }));
    const installed = await ensureDefaultProxy({
      env,
      root: isolated.root,
      pluginRoot: PLUGIN,
      sessionId: 'err-1',
    });
    const down = await postJson(`${installed.proxyUrl}/v1/messages`, BODY, {
      sessionId: 'err-1',
    });
    assert.equal(down.status, 502, down.text);
    assert.equal(down.headers['x-should-retry'], 'true');

    // The TLS upstream without its CA: a certificate error, never retried.
    const config = readProxyConfig(proxyPaths(env));
    const install = Object.values(config.installs)[0];
    install.upstream = corp.upstreamUrl.replace(UPSTREAM_HOST, 'localhost');
    writeFileSync(proxyPaths(env).config, JSON.stringify(config));
    const untrusted = await postJson(
      `${installed.proxyUrl}/v1/messages`,
      BODY,
      {
        sessionId: 'err-1',
      },
    );
    assert.equal(untrusted.status, 400, untrusted.text);
    assert.equal(untrusted.headers['x-should-retry'], 'false');
    assert.match(untrusted.text, /NODE_EXTRA_CA_CERTS/u);
  },
);
