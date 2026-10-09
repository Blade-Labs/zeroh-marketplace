// SPDX-License-Identifier: AGPL-3.0-only

export { loadAllowRules } from '../zeroh-disclosure-core/allow-rules.js';
export {
  isAnthropicCredentialEnvName,
  isClaudeCodeOwnEnvName,
  isSecretName,
  loadKnownSecrets,
  usersKnownSecrets,
} from './secrets/detect.js';
export {
  exactValueHits,
  expiredTokens,
  restore,
  restoreDeep,
  scrub,
  scrubDeep,
} from './secrets/rewrite.js';
export {
  allowedHosts,
  bashSensitiveReason,
  builtInDestinations,
  checkDestinations,
  commandNamesZeroHSecret,
  destinationText,
  hostsIn,
  isSensitivePath,
  isZeroHSecretPath,
  maskedHost,
  mcpServerAllowed,
  mcpServerOf,
  networkHostsIn,
  powershellSensitiveReason,
} from './secrets/decide.js';
