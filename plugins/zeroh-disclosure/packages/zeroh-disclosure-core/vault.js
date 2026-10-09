// SPDX-License-Identifier: AGPL-3.0-only

// Stable vault entrypoint. Implementations are split by concern.
export {
  acquireFileLock,
  createKeyFile,
  fileLockOwnerText,
  isVaultError,
  projectKey,
  releaseFileLock,
  saveQuietly,
  tokenHashKey,
  VAULT_LOCK,
  VAULT_VERSION,
  vaultError,
  vaultProblem,
} from './vault/store.js';
export { Vault } from './vault/scope.js';
export { checkVaults, resetVaults, vaultRetention } from './vault/lifecycle.js';
export { protectWindowsPath, zerohHome } from './private-fs.js';
