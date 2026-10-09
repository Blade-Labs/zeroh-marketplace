// SPDX-License-Identifier: AGPL-3.0-only

// Request routing and daemon control endpoints.
import { DEFAULT_ANTHROPIC_UPSTREAM } from '../claude-settings.js';
import { sameSecret } from '../../zeroh-disclosure-core/crypto.js';
import { networkFingerprint } from '../network.js';
import { MESSAGES } from '../proxy.js';
import { writeProxyDiagnostic } from '../proxy-report.js';
import {
  anyLiveRoute,
  healthProof,
  liveMaskingRoots,
  markRouteSeen,
  readRoute,
} from '../proxy-state.js';

function sessionHeader(request) {
  return String(request?.headers?.['x-claude-code-session-id'] || '');
}

function accessKey(request) {
  return /^\/z\/([A-Za-z0-9_-]{16,128})(?:\/|$)/u.exec(
    String(request?.url || ''),
  )?.[1];
}

function createInstallAccess(context, notices) {
  function installForKey(key) {
    if (!key) return null;
    const installs = Object.values(context.servingConfig()?.installs || {});
    return installs.find((candidate) => sameSecret(candidate.key, key)) || null;
  }

  function installIdForKey(key) {
    if (!key) return null;
    for (const [id, install] of Object.entries(
      context.servingConfig()?.installs || {},
    )) {
      if (sameSecret(install.key, key)) return id;
    }
    return null;
  }

  function resolveUpstream(key) {
    const install = installForKey(key);
    if (install?.upstream) return install.upstream;
    const upstreams = [
      ...new Set(
        Object.values(context.servingConfig()?.installs || {})
          .map((candidate) => candidate.upstream)
          .filter(Boolean),
      ),
    ];
    if (!notices.unknownKeyReported && !context.getRetired()) {
      notices.unknownKeyReported = true;
      context.log('a request with an unknown access key was forwarded');
      writeProxyDiagnostic({
        event: 'unknown-access-key',
        failure: key ? 'unknown-key' : 'no-key',
        steps: [{ step: 'forward', ok: true, found: upstreams.length }],
        proxy: {
          port: Number(context.getConfig().port),
          daemonAnswers: true,
        },
      });
    }
    return upstreams.length === 1 ? upstreams[0] : DEFAULT_ANTHROPIC_UPSTREAM;
  }

  return { installForKey, installIdForKey, resolveUpstream };
}

function createRouteAccess(context, notices, installs) {
  function decideRoute(sessionId, { hasBody, key = null }) {
    if (!hasBody) return { action: 'pass', quiet: true };
    const retired = context.getRetired();
    if (retired) {
      const masker = retired.sessions.get(String(sessionId));
      return masker
        ? { action: 'known', masker }
        : { action: 'pass', quiet: true };
    }
    const route = sessionId ? readRoute(context.paths, sessionId) : null;
    if (route) {
      return route.optOut
        ? { action: 'pass', notice: MESSAGES.optedOut }
        : { action: 'mask', root: route.root, route };
    }
    if (!notices.unroutedReported) {
      notices.unroutedReported = true;
      const live = liveMaskingRoots(context.paths, {
        install: installs.installIdForKey(key),
      });
      context.log(
        `a request with ${sessionId ? 'a session id no ZeroH hook registered' : 'no session header'} passed unmasked (${live.size} project(s) had a live plugin session): nothing could restore tokens in it`,
      );
    }
    return { action: 'pass', notice: MESSAGES.noRoute, unrouted: true };
  }

  function sessionState(sessionId) {
    if (context.getRetired()) return 'pass';
    const route = readRoute(context.paths, sessionId);
    return route && !route.optOut ? 'mask' : 'pass';
  }

  function route(request, { hasBody }) {
    context.onRequest();
    // State may disappear after headers were accepted but before the body
    // completed. Enter cached draining before deciding whether to mask it.
    context.servingConfig();
    const decision = decideRoute(sessionHeader(request), {
      hasBody,
      key: accessKey(request),
    });
    if (decision.route) {
      markRouteSeen(context.paths, decision.route);
      context.onRouted?.(decision.route);
    }
    return decision;
  }

  return { decideRoute, route, sessionState };
}

function createHealthResponder(context, installs, routes) {
  return function healthResponse(request, key) {
    if (!context.getRetired()) context.currentConfig();
    const sessionId = sessionHeader(request);
    const session = sessionId ? routes.sessionState(sessionId) : null;
    const config = context.getConfig();
    const retired = context.getRetired();
    const body = {
      ok: true,
      version: 1,
      pid: process.pid,
      build: context.getBuild(),
      mode: context.getMode(),
      network: networkFingerprint(context.getNetwork(), config.controlToken),
      active: retired
        ? false
        : sessionId
          ? session === 'mask'
          : anyLiveRoute(context.paths),
      ...(retired ? { retired: true } : {}),
      ...(session ? { session } : {}),
      ...(key !== null
        ? { key: installs.installForKey(key) ? 'known' : 'unknown' }
        : {}),
    };
    const nonce = String(request.headers['x-zeroh-nonce'] || '');
    if (nonce) {
      body.proof = healthProof(config.controlToken, {
        nonce,
        sessionId,
        session: body.session,
      });
    }
    return body;
  };
}

function createControlHandler(context, healthResponse) {
  return function handleRequest(request, response) {
    const raw = String(request.url || '/');
    if (!raw.startsWith('/') || raw.startsWith('//')) return false;
    const pathname = raw.split('?')[0];
    const health = /^(?:\/z\/([A-Za-z0-9_-]{16,128}))?\/_zeroh\/health$/u.exec(
      pathname,
    );
    if (health && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(healthResponse(request, health[1] ?? null)));
      return true;
    }
    if (pathname === '/_zeroh/retire' && request.method === 'POST') {
      const allowed = sameSecret(
        request.headers['x-zeroh-control'] || '',
        context.getConfig().controlToken,
      );
      const none = /(?:^|&)masker=none(?:&|$)/u.test(raw.split('?')[1] ?? '');
      const draining = /(?:^|&)mode=draining(?:&|$)/u.test(
        raw.split('?')[1] ?? '',
      );
      if (allowed)
        context.retire({
          masking: none ? 'none' : 'known',
          mode: draining ? 'draining' : 'retired',
        });
      response.writeHead(allowed ? 204 : 403);
      response.end();
      return true;
    }
    if (pathname === '/_zeroh/shutdown' && request.method === 'POST') {
      const allowed = sameSecret(
        request.headers['x-zeroh-control'] || '',
        context.getConfig().controlToken,
      );
      response.writeHead(allowed ? 204 : 403);
      response.end();
      if (allowed) setImmediate(() => context.stop('shutdown requested'));
      return true;
    }
    return false;
  };
}

export function createDaemonRequests(context) {
  const notices = { unknownKeyReported: false, unroutedReported: false };
  const installs = createInstallAccess(context, notices);
  const routes = createRouteAccess(context, notices, installs);
  const healthResponse = createHealthResponder(context, installs, routes);
  return {
    decideRoute: routes.decideRoute,
    handleRequest: createControlHandler(context, healthResponse),
    resolveUpstream: installs.resolveUpstream,
    route: routes.route,
  };
}
