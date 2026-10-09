// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import test from 'node:test';

import {
  healthProof,
  proxyPathsInHome,
  routeFileName,
  proxyPaths,
  pruneMaskingSnapshots,
  readRoute,
  ROUTE_MAX_AGE_MS,
  writeRoute,
} from '../../packages/local-proxy/proxy-state.js';
import { writePrivateJson } from '../../packages/zeroh-disclosure-core/private-fs.js';
import { isolatedProxyEnvironment, PLUGIN } from '../helpers.mjs';

const routePath = (paths, sessionId) =>
  path.join(paths.routes, routeFileName(sessionId));

test('proxy state keeps every path inside the selected ZeroH home', () => {
  const home = path.resolve('/tmp/zeroh-acceptance/sol-46/proxy-state-home');
  const paths = proxyPathsInHome(home);
  for (const value of Object.values(paths)) {
    const resolved = path.resolve(value);
    assert.ok(resolved === home || resolved.startsWith(`${home}${path.sep}`));
  }
});

test('proxy state route filenames are stable and do not expose session ids', () => {
  const first = routeFileName('session-one');
  assert.equal(first, routeFileName('session-one'));
  assert.notEqual(first, routeFileName('session-two'));
  assert.doesNotMatch(first, /session/u);
});

test('proxy state health proofs bind the nonce and session', () => {
  const options = {
    nonce: 'fake-nonce',
    sessionId: 'fake-session',
    session: 'live',
  };
  const proof = healthProof('fake-control-key', options);
  assert.equal(proof, healthProof('fake-control-key', options));
  assert.notEqual(
    proof,
    healthProof('fake-control-key', { ...options, nonce: 'other-nonce' }),
  );
  assert.notEqual(
    proof,
    healthProof('fake-control-key', { ...options, sessionId: 'other-session' }),
  );
  assert.notEqual(
    proof,
    healthProof('fake-control-key', { ...options, session: 'other-state' }),
  );
});

test('masking snapshots expire with routes and release a project after its last session ends', () => {
  const isolated = isolatedProxyEnvironment('snapshot-retention');
  const paths = proxyPaths(isolated.env);
  writePrivateJson(paths.config, {});
  const roots = ['live', 'ended', 'expired'].map((name) =>
    path.join(isolated.root, name),
  );
  const sessions = new Map([
    ['live-a', roots[0]],
    ['live-b', roots[0]],
    ['ended', roots[1]],
    ['expired', roots[2]],
  ]);
  const vaults = new Map(
    roots.map((root) => [root, [{ value: 'ZEROHFAKE cached catalog' }]]),
  );
  for (const [sessionId, root] of sessions)
    writeRoute(paths, { sessionId, root, pluginDir: PLUGIN });
  const now = Date.now();
  writePrivateJson(routePath(paths, 'expired'), {
    ...readRoute(paths, 'expired'),
    at: new Date(now - ROUTE_MAX_AGE_MS - 1).toISOString(),
  });
  writePrivateJson(routePath(paths, 'ended'), {
    ...readRoute(paths, 'ended'),
    ended: true,
  });
  pruneMaskingSnapshots(paths, sessions, vaults, { now });
  assert.deepEqual([...sessions.keys()], ['live-a', 'live-b']);
  assert.deepEqual([...vaults.keys()], [roots[0]]);

  writePrivateJson(routePath(paths, 'live-a'), {
    ...readRoute(paths, 'live-a'),
    ended: true,
  });
  pruneMaskingSnapshots(paths, sessions, vaults, { now });
  assert.deepEqual([...sessions.keys()], ['live-b']);
  assert.equal(vaults.size, 1, 'another session still references the project');
  writePrivateJson(routePath(paths, 'live-b'), {
    ...readRoute(paths, 'live-b'),
    ended: true,
  });
  pruneMaskingSnapshots(paths, sessions, vaults, { now });
  assert.equal(sessions.size, 0);
  assert.equal(vaults.size, 0, 'historical project catalogs are released');
});

test('missing config or routes preserve masking snapshots for home-loss draining', () => {
  const isolated = isolatedProxyEnvironment('snapshot-home-loss');
  const paths = proxyPaths(isolated.env);
  writePrivateJson(paths.config, {});
  const sessions = new Map([['expired-session', isolated.root]]);
  const vaults = new Map([
    [isolated.root, [{ value: 'ZEROHFAKE cached catalog' }]],
  ]);
  writeRoute(paths, {
    sessionId: 'expired-session',
    root: isolated.root,
    pluginDir: PLUGIN,
  });
  const now = Date.now() + ROUTE_MAX_AGE_MS + 1_000;
  rmSync(paths.config);
  pruneMaskingSnapshots(paths, sessions, vaults, { now });
  assert.equal(sessions.size, 1);
  assert.equal(vaults.size, 1);
  writePrivateJson(paths.config, {});
  rmSync(paths.routes, { recursive: true, force: true });
  pruneMaskingSnapshots(paths, sessions, vaults, { now });
  assert.equal(sessions.size, 1);
  assert.equal(vaults.size, 1);
  mkdirSync(paths.routes);
  pruneMaskingSnapshots(paths, sessions, vaults, { now });
  assert.equal(
    sessions.size,
    0,
    'existing state with no route releases the snapshot',
  );
  assert.equal(vaults.size, 0);
});
