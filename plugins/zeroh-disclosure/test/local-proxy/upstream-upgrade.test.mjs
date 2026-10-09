// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_ANTHROPIC_UPSTREAM,
  installId,
  writeRestoreRecord,
} from '../../lib/claude-settings.js';
import {
  ensureDefaultProxy,
  probeProxy,
  routeSession,
  stopDefaultProxy,
} from '../../packages/local-proxy/proxy-manager.js';
import { waitForPortFree } from '../../packages/local-proxy/manager/probe.js';
import {
  proxyPaths,
  readProxyConfig,
  writeProxyConfig,
} from '../../packages/local-proxy/proxy-state.js';
import { fakeDefaultUpstream, HAS_OPENSSL } from '../default-upstream.mjs';
import {
  fakeUpstream,
  isolatedProxyEnvironment,
  PLUGIN,
  postJson,
} from '../helpers.mjs';

const BODY = '{"messages":[{"role":"user","content":"hello"}]}';
const networkTest = HAS_OPENSSL ? test : test.skip;

async function legacyInstall(t, writeSettings) {
  const isolated = isolatedProxyEnvironment('upstream-upgrade');
  const x = await fakeUpstream();
  const y = await fakeUpstream();
  const defaultUpstream = await fakeDefaultUpstream(t, isolated.root);
  const env = {
    ...isolated.env,
    ...defaultUpstream.environment,
    CLAUDE_CONFIG_DIR: path.dirname(isolated.settings),
    ZEROH_CLAUDE_BIN: process.env.ZEROH_CLAUDE_BIN,
  };
  t.after(() => x.close());
  t.after(() => y.close());
  t.after(() => stopDefaultProxy({ env }));
  // Start a real daemon on X, then build exactly the record 074309c42
  // wrote when its settings original was absent and shell gateway X won.
  writeFileSync(
    isolated.settings,
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: x.url } }),
  );
  const options = {
    env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    registerLoginItem: false,
  };
  const first = await ensureDefaultProxy({ ...options, writeSettings });
  const paths = proxyPaths(env);
  const config = readProxyConfig(paths);
  const install = config.installs[installId(isolated.settings)];
  install.originalBaseUrlPresent = false;
  delete install.originalBaseUrlValue;
  install.createdEnv = true;
  if (writeSettings) writeRestoreRecord(install);
  else {
    writeFileSync(isolated.settings, '{}');
    install.proxyUrl = null;
  }
  writeProxyConfig(paths, config);
  assert.ok(
    readProxyConfig(paths).installs[installId(isolated.settings)].upstream ===
      x.url,
  );
  return { isolated, x, y, defaultUpstream, env, options, first, paths };
}

for (const writeSettings of [false, true]) {
  for (const entry of [
    'no-variable',
    'gateway-y',
    'configured',
    'anthropic',
    'ensure',
  ]) {
    networkTest(
      `${entry} reconciles a live environment-seeded install (writeSettings:${writeSettings})`,
      async (t) => {
        const { isolated, x, y, defaultUpstream, env, options, first, paths } =
          await legacyInstall(t, writeSettings);
        if (entry === 'ensure') {
          const result = await ensureDefaultProxy({
            ...options,
            writeSettings,
          });
          assert.equal(
            result.pid,
            first.pid,
            'the healthy daemon should reload its corrected config',
          );
        } else {
          const base = {
            'gateway-y': y.url,
            configured: first.proxyUrl,
            anthropic: DEFAULT_ANTHROPIC_UPSTREAM,
          }[entry];
          const result = await routeSession({
            ...options,
            env: { ...env, ...(base ? { ANTHROPIC_BASE_URL: base } : {}) },
            sessionId: 'ZEROHFAKE-upgraded',
            waitMs: 0,
            now: () => statSync(isolated.settings).mtimeMs,
          });
          assert.deepEqual(
            result,
            entry === 'gateway-y'
              ? { routed: false, state: 'overridden' }
              : entry === 'configured'
                ? { routed: false, state: 'configured' }
                : { routed: true, state: 'routed' },
          );
        }
        const response = await postJson(`${first.proxyUrl}/v1/messages`, BODY, {
          sessionId: 'ZEROHFAKE-upgraded',
          headers: { authorization: 'Bearer ZEROHFAKE-upgraded' },
        });
        assert.equal(response.status, 200);
        assert.equal(
          x.seen.length,
          0,
          'legacy shell gateway received the later session',
        );
        assert.equal(defaultUpstream.seen.length, 1);
        assert.ok(
          readProxyConfig(paths).installs[installId(isolated.settings)]
            .upstream === DEFAULT_ANTHROPIC_UPSTREAM,
        );
        assert.deepEqual(
          await routeSession({
            ...options,
            env: { ...env, ANTHROPIC_BASE_URL: y.url },
          }),
          {
            routed: false,
            state: 'overridden',
          },
        );
        assert.equal(
          (await postJson(`${y.url}/v1/messages`, BODY)).status,
          200,
        );
        assert.equal(y.seen.length, 1);
      },
    );
  }

  networkTest(
    `daemon start reconciles an environment-seeded install (writeSettings:${writeSettings})`,
    async (t) => {
      const { isolated, x, defaultUpstream, env, first, paths } =
        await legacyInstall(t, writeSettings);
      const config = readProxyConfig(paths);
      process.kill(first.pid, 'SIGKILL');
      assert.equal(await waitForPortFree(config.port, 5_000), true);
      // Start the installed runtime exactly as a login item does; no manager.
      const child = spawn(
        process.execPath,
        [path.join(paths.runtime, 'bin', 'proxy-daemon.mjs'), paths.config],
        {
          env,
          stdio: 'ignore',
        },
      );
      t.after(() => child.kill());
      let health = null;
      for (let attempt = 0; attempt < 100 && !health; attempt += 1) {
        health = await probeProxy(first.proxyUrl, {
          controlToken: config.controlToken,
        });
        if (!health) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(health, 'login-item daemon did not start');
      assert.equal(health.pid, child.pid);
      assert.equal(
        (await postJson(`${first.proxyUrl}/v1/messages`, BODY)).status,
        200,
      );
      assert.equal(x.seen.length, 0);
      assert.equal(defaultUpstream.seen.length, 1);
      assert.ok(
        readProxyConfig(paths).installs[installId(isolated.settings)]
          .upstream === DEFAULT_ANTHROPIC_UPSTREAM,
      );
    },
  );
}

networkTest(
  'upgrade preserves a settings original and corrects other installs sharing the daemon',
  async (t) => {
    const { isolated, x, y, env, options, first, paths } = await legacyInstall(
      t,
      true,
    );
    const config = readProxyConfig(paths);
    const install = config.installs[installId(isolated.settings)];
    install.originalBaseUrlPresent = true;
    install.originalBaseUrlValue = y.url;
    writeRestoreRecord(install);
    const otherSettings = path.join(isolated.root, 'other-settings.json');
    t.after(() => stopDefaultProxy({ env, settingsPath: otherSettings }));
    config.installs[installId(otherSettings)] = {
      settingsPath: otherSettings,
      key: 'ZEROHFAKE-other-install',
      upstream: x.url,
      originalBaseUrlPresent: false,
    };
    writeProxyConfig(paths, config);
    await ensureDefaultProxy(options);
    assert.equal(
      (await postJson(`${first.proxyUrl}/v1/messages`, BODY)).status,
      200,
    );
    assert.equal(x.seen.length, 0);
    assert.equal(y.seen.length, 1);
    const corrected = readProxyConfig(paths);
    assert.ok(
      corrected.installs[installId(isolated.settings)].upstream === y.url,
    );
    assert.ok(
      corrected.installs[installId(otherSettings)].upstream ===
        DEFAULT_ANTHROPIC_UPSTREAM,
    );
    // Remove the extra fixture so normal cleanup stops this daemon too.
    delete corrected.installs[installId(otherSettings)];
    writeProxyConfig(paths, corrected);
    assert.equal((await ensureDefaultProxy(options)).pid, first.pid);
  },
);

networkTest(
  'a session is not routed when applying the upgrade correction fails',
  async (t) => {
    const { options, first } = await legacyInstall(t, true);
    assert.deepEqual(
      await routeSession({
        ...options,
        env: { ...options.env, ANTHROPIC_BASE_URL: first.proxyUrl },
        pluginRoot: path.join(options.root, 'missing-plugin'),
      }),
      { routed: false, state: 'not-written' },
    );
  },
);
