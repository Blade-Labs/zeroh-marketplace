// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_ANTHROPIC_UPSTREAM,
  installId,
} from '../../lib/claude-settings.js';
import {
  baseUrlRoutingState,
  ensureDefaultProxy,
  prepareInstall,
  routeSession,
  stopDefaultProxy,
} from '../../packages/local-proxy/proxy-manager.js';
import {
  proxyPaths,
  readProxyConfig,
  writeProxyConfig,
} from '../../packages/local-proxy/proxy-state.js';
import {
  fakeUpstream,
  isolatedProxyEnvironment,
  PLUGIN,
  postJson,
} from '../helpers.mjs';
import { fakeDefaultUpstream, HAS_OPENSSL } from '../default-upstream.mjs';

const BODY = '{"messages":[{"role":"user","content":"hello"}]}';
const networkTest = HAS_OPENSSL ? test : test.skip;

for (const suffix of ['', '/']) {
  networkTest(
    `Anthropic environment URL${suffix ? ' with trailing slash' : ''} routes and a no-variable session shares the default`,
    async (t) => {
      const isolated = isolatedProxyEnvironment('anthropic-environment');
      const upstream = await fakeDefaultUpstream(t, isolated.root);
      const env = { ...isolated.env, ...upstream.environment };
      t.after(() => stopDefaultProxy({ env }));
      const options = {
        env: {
          ...env,
          ANTHROPIC_BASE_URL: `${DEFAULT_ANTHROPIC_UPSTREAM}${suffix}`,
        },
        root: isolated.root,
        pluginRoot: PLUGIN,
        sessionId: 'ZEROHFAKE-default-a',
        waitMs: 0,
      };
      assert.deepEqual(await routeSession(options), {
        routed: true,
        state: 'routed',
      });
      const paths = proxyPaths(isolated.env);
      const config = readProxyConfig(paths);
      const install = config.installs[installId(isolated.settings)];
      assert.equal(install.upstream, DEFAULT_ANTHROPIC_UPSTREAM);
      const second = await ensureDefaultProxy({
        ...options,
        env,
        sessionId: 'ZEROHFAKE-default-b',
      });
      assert.equal(second.proxyUrl, install.proxyUrl);
      for (const sessionId of ['ZEROHFAKE-default-a', 'ZEROHFAKE-default-b']) {
        const response = await postJson(
          `${second.proxyUrl}/v1/messages`,
          BODY,
          {
            sessionId,
          },
        );
        assert.equal(response.status, 200);
      }
      assert.equal(upstream.seen.length, 2);
    },
  );
}

networkTest(
  'shell gateway X cannot capture gateway Y or a no-variable session',
  async (t) => {
    const isolated = isolatedProxyEnvironment('environment-gateways');
    const x = await fakeUpstream();
    const y = await fakeUpstream();
    const defaultUpstream = await fakeDefaultUpstream(t, isolated.root);
    const env = { ...isolated.env, ...defaultUpstream.environment };
    t.after(() => x.close());
    t.after(() => y.close());
    t.after(() => stopDefaultProxy({ env }));
    const options = { root: isolated.root, pluginRoot: PLUGIN, waitMs: 0 };
    const envX = { ...env, ANTHROPIC_BASE_URL: x.url };
    const first = await ensureDefaultProxy({
      ...options,
      env: envX,
      writeSettings: false,
    });
    assert.deepEqual(await routeSession({ ...options, env: envX }), {
      routed: false,
      state: 'overridden',
    });
    assert.deepEqual(
      await routeSession({
        ...options,
        env: { ...env, ANTHROPIC_BASE_URL: y.url },
      }),
      { routed: false, state: 'overridden' },
    );
    const paths = proxyPaths(isolated.env);
    const config = readProxyConfig(paths);
    const install = config.installs[installId(isolated.settings)];
    assert.equal(install.upstream, DEFAULT_ANTHROPIC_UPSTREAM);
    const noVariable = await routeSession({
      ...options,
      env,
      sessionId: 'ZEROHFAKE-no-variable',
    });
    assert.equal(noVariable.routed, true);
    assert.equal(
      (
        await postJson(`${y.url}/v1/messages`, BODY, {
          headers: { authorization: 'Bearer ZEROHFAKE-session-y' },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await postJson(`${first.proxyUrl}/v1/messages`, BODY, {
          sessionId: 'ZEROHFAKE-no-variable',
        })
      ).status,
      200,
    );
    assert.equal(x.seen.length, 0);
    assert.equal(y.seen.length, 1);
    assert.ok(y.seen[0].headers.authorization === 'Bearer ZEROHFAKE-session-y');
    assert.equal(defaultUpstream.seen.length, 1);
  },
);

test('a gateway recorded from settings remains routed and receives model requests', async (t) => {
  const isolated = isolatedProxyEnvironment('settings-gateway');
  const gateway = await fakeUpstream();
  t.after(() => gateway.close());
  t.after(() => stopDefaultProxy({ env: isolated.env }));
  writeFileSync(
    isolated.settings,
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: gateway.url } }),
  );
  const options = {
    env: { ...isolated.env, ANTHROPIC_BASE_URL: gateway.url },
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-settings',
    waitMs: 0,
  };
  await ensureDefaultProxy({ ...options, writeSettings: false });
  assert.equal((await routeSession(options)).routed, true);
  const install = readProxyConfig(proxyPaths(isolated.env)).installs[
    installId(isolated.settings)
  ];
  assert.equal(install.upstream, gateway.url);
  assert.equal(install.originalBaseUrlValue, gateway.url);
  assert.equal(
    (
      await postJson(`${install.proxyUrl}/v1/messages`, BODY, {
        sessionId: options.sessionId,
      })
    ).status,
    200,
  );
  assert.equal(gateway.seen.length, 1);
});

test('install preparation never seeds its upstream from the environment', async () => {
  const isolated = isolatedProxyEnvironment('install-environment');
  for (const value of [
    'https://gateway.example.com',
    `${DEFAULT_ANTHROPIC_UPSTREAM}/`,
    'http://127.0.0.1:9',
  ]) {
    const install = await prepareInstall({
      env: { ...isolated.env, ANTHROPIC_BASE_URL: value },
      paths: proxyPaths(isolated.env),
      settingsPath: isolated.settings,
    });
    assert.equal(install.upstream, DEFAULT_ANTHROPIC_UPSTREAM);
    assert.equal(install.originalBaseUrlPresent, false);
  }
});

test('matching a legacy environment-seeded install never authorizes a shell gateway', () => {
  const isolated = isolatedProxyEnvironment('legacy-environment-install');
  const upstream = 'https://gateway.example.com';
  writeProxyConfig(proxyPaths(isolated.env), {
    controlToken: 'ZEROHFAKE-control',
    installs: {
      [installId(isolated.settings)]: {
        settingsPath: isolated.settings,
        upstream,
        originalBaseUrlPresent: false,
      },
    },
  });
  assert.equal(
    baseUrlRoutingState({
      env: { ...isolated.env, ANTHROPIC_BASE_URL: upstream },
      cwd: isolated.root,
    }),
    'overridden',
  );
  assert.equal(
    baseUrlRoutingState({
      env: { ...isolated.env, ANTHROPIC_BASE_URL: DEFAULT_ANTHROPIC_UPSTREAM },
      cwd: isolated.root,
    }),
    'upstream-mismatch',
  );
});

test('other hosts, ports, paths and URL components stay overridden; credentials keep their own state', () => {
  const isolated = isolatedProxyEnvironment('environment-url-shapes');
  for (const value of [
    'https://gateway.example.com',
    'http://api.anthropic.com',
    'https://api.anthropic.com:444',
    'https://api.anthropic.com/v1',
    'https://api.anthropic.com//',
    'https://api.anthropic.com/?key=ZEROHFAKE-query',
    'https://api.anthropic.com/#fragment',
  ]) {
    assert.equal(
      baseUrlRoutingState({
        env: { ...isolated.env, ANTHROPIC_BASE_URL: value },
        cwd: isolated.root,
      }),
      'overridden',
    );
  }
  assert.equal(
    baseUrlRoutingState({
      env: {
        ...isolated.env,
        ANTHROPIC_BASE_URL:
          'https://fake:ZEROHFAKE-password@gateway.example.com',
      },
      cwd: isolated.root,
    }),
    'credentials',
  );
});
