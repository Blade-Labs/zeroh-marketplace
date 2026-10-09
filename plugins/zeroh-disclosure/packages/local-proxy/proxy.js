// SPDX-License-Identifier: AGPL-3.0-only

// Stable public entry for local request masking and upstream forwarding.
export { knownValueMasker, scrubBody, typedMaskNote } from './scrub.js';
export {
  MESSAGES,
  UPSTREAM_CONNECT_TIMEOUT_MS,
  createMaskingProxy,
  isProxyLoop,
  listen,
  parseProxyTarget,
  upstreamFailure,
  upstreamTarget,
} from './upstream.js';
