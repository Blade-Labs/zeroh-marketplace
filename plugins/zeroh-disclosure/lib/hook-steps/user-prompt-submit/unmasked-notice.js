// SPDX-License-Identifier: AGPL-3.0-only

import { baseUrlOverrideSource } from '../../../packages/local-proxy/proxy-manager.js';
import {
  ProtectionState,
  ProtectionSurface,
  protectionWording,
} from '../../../packages/zeroh-disclosure-core/protection-state.js';

const REASONS = Object.freeze({
  overridden: 'base-url-overridden',
  'upstream-mismatch': 'upstream-mismatch',
  credentials: 'base-url-credentials',
});

const WHY = Object.freeze({
  overridden: protectionWording(ProtectionState.OVERRIDDEN, {
    surface: ProtectionSurface.STATUS,
  }).word,
  'upstream-mismatch': protectionWording(ProtectionState.UPSTREAM_MISMATCH, {
    surface: ProtectionSurface.STATUS,
  }).word,
  credentials: protectionWording(ProtectionState.BASE_URL_CREDENTIALS, {
    surface: ProtectionSurface.STATUS,
  }).word,
});

const FIX = Object.freeze({
  off: 'You turned the local proxy off; /zeroh-disclosure:proxy on turns it back on.',
  provider:
    'Claude Code talks to Bedrock, Vertex or Foundry directly, so there is no proxy to mask it.',
  'not-ready':
    'This session was just switched to the proxy; from your next prompt it is masked.',
  overridden:
    "Remove ANTHROPIC_BASE_URL where it is set and start Claude Code again; /zeroh-disclosure:doctor shows where. To use a gateway through ZeroH, put ANTHROPIC_BASE_URL in Claude Code's settings.json env; ZeroH records it as the original upstream and routes through it. Typed prompts are not masked in this session; files and command output still are.",
  'upstream-mismatch':
    "ANTHROPIC_BASE_URL does not match this install's upstream; /zeroh-disclosure:doctor shows both sources without showing their URLs. Put the gateway in Claude Code's settings.json env so ZeroH records it as the original upstream and routes through it. Typed prompts are not masked in this session; files and command output still are.",
  credentials:
    'Remove credentials from ANTHROPIC_BASE_URL and use the provider authorization settings instead.',
  default: 'Fix it with /zeroh-disclosure:doctor.',
});

export async function unmaskedPromptNoticeContext({ stopReason, cwd }) {
  const namesOutsideHost = [
    'overridden',
    'upstream-mismatch',
    'credentials',
  ].includes(stopReason);
  const host = namesOutsideHost
    ? (await baseUrlOverrideSource({ cwd })).host
    : null;
  const routeDetail =
    stopReason === 'credentials'
      ? `The URL names ${host ?? 'that address'}; its credentials are not shown. `
      : ['overridden', 'upstream-mismatch'].includes(stopReason)
        ? `Claude Code sends to ${host ?? 'that address'} instead of the local proxy. `
        : '';
  return {
    reason: REASONS[stopReason] ?? 'proxy-not-running',
    why: WHY[stopReason] ?? null,
    suffix: `${routeDetail}${FIX[stopReason] ?? FIX.default}`,
  };
}
