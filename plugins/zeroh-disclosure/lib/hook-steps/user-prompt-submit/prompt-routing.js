// SPDX-License-Identifier: AGPL-3.0-only

import {
  projectDir,
  proxyActive,
  proxyConfirmed,
  proxyState,
  refreshRoute,
  stopPrompt,
} from '../../hook-io.js';
import {
  checkSessionProxy,
  routeSession,
} from '../../../packages/local-proxy/proxy-manager.js';
import {
  takeUninstallFailure,
  uninstallFailureNotice,
} from '../../../packages/zeroh-disclosure-core/uninstall-marker.js';

export async function resolvePromptRouting({ event, typedSecrets }) {
  const sessionId = event?.session_id;
  const root = projectDir(event);
  refreshRoute(event);
  let proxyOn = await proxyActive({ sessionId });
  const removalFailure = takeUninstallFailure();
  let routingNotice = removalFailure
    ? uninstallFailureNotice(removalFailure)
    : null;
  const addRoutingNotice = (notice) => {
    routingNotice = [routingNotice, notice].filter(Boolean).join('\n');
  };
  let stopReason = null;
  let switchedNow = false;

  if (!proxyOn) {
    const routing = await routeSession({ sessionId, root });
    proxyOn = routing.routed;
    switchedNow = routing.routed;
    if (routing.state === 'configured') {
      const guard = await checkSessionProxy({ sessionId, root });
      // deny-inventory: dead-proxy
      if (guard.block) stopPrompt(guard.message);
      refreshRoute(event);
      proxyOn = await proxyActive({ sessionId });
      if (!proxyOn)
        stopReason = guard.state === 'retired' ? 'off' : 'unreachable';
    } else if (routing.state === 'not-written') {
      stopReason = 'not-set-up';
      addRoutingNotice(
        `ZeroH Disclosure couldn't put this session behind its local proxy, so what you type can't be masked; ${typedSecrets}. \`/zeroh-disclosure:doctor\` shows why.`,
      );
    } else if (routing.state === 'not-applied') {
      stopReason = 'not-applied';
      addRoutingNotice(
        `ZeroH Disclosure: Claude Code didn't switch this session to the local proxy, so what you type can't be masked here; ${typedSecrets}. Check ANTHROPIC_BASE_URL and run /zeroh-disclosure:doctor.`,
      );
    } else if (routing.state === 'overridden') {
      stopReason = 'overridden';
    } else if (routing.state === 'upstream-mismatch') {
      stopReason = 'upstream-mismatch';
    } else if (routing.state === 'credentials') {
      stopReason = 'credentials';
    } else if (routing.state === 'not-configured') {
      const state = await proxyState({ sessionId, root });
      stopReason = state === 'provider' ? 'provider' : 'off';
    }
  }

  if (proxyOn && !proxyConfirmed({ sessionId })) {
    proxyOn = false;
    stopReason = 'not-ready';
  }
  return { proxyOn, routingNotice, stopReason, switchedNow };
}
