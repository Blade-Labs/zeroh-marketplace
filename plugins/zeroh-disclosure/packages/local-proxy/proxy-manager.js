// SPDX-License-Identifier: AGPL-3.0-only

// Stable public entry for the local proxy lifecycle manager.
export {
  PROMPT_RESTART_BUDGET_MS,
  PROXY_DOWN_MESSAGE,
  SETTINGS_APPLY_WAIT_MS,
  probeProxy,
  providerBypassesProxy,
  proxyDisabled,
  proxyOptedOut,
  proxyTurnedOffByUser,
} from './manager/probe.js';
export {
  compareVersions,
  ensureDefaultProxy,
  newerBuild,
  pluginBuild,
  prepareInstall,
} from './manager/install.js';
export {
  evaluateOrphanCleanup,
  evaluateSessionOnlyExit,
  removeProxyEverywhere,
  restoreClaudeSettings,
  stopDefaultProxy,
} from './manager/orphans.js';
export {
  baseUrlOverridden,
  baseUrlOverrideSource,
  baseUrlRoutingState,
  checkSessionProxy,
  proxyOn,
  refreshRoute,
  repairDeadProxySetting,
  routeSession,
  sessionNamesInstallProxy,
  sessionProxyState,
  settingsEntryState,
} from './manager/routes.js';
export { diagnoseProxy, proxyRuntimeStatus } from './manager/diagnose.js';
