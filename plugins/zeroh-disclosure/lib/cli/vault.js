// SPDX-License-Identifier: AGPL-3.0-only

import { cleanupStaleRunFiles } from '../../packages/shell-analysis/late-bind.js';
import { pruneCommitmentKeys } from '../../packages/zeroh-disclosure-core/session.js';
import {
  isVaultError,
  resetVaults,
  Vault,
  vaultProblem,
} from '../../packages/zeroh-disclosure-core/vault.js';
import { authorized, print } from './shared.js';

export async function cmdVault(args, cwd) {
  const action = args._[1];
  if (action === 'status') {
    // Read-only: status never writes or prunes the vault.
    let status;
    try {
      status = new Vault(cwd).status();
    } catch (error) {
      if (!isVaultError(error)) throw error;
      const problem = vaultProblem(error);
      throw new Error(
        `this project's vault can't be opened: ${problem.reason}. ${problem.fix}`,
      );
    }
    print({ project: cwd, ...status }, args.json, [
      `project: ${cwd}`,
      `retention: ${status.retention} (${status.retention_source === 'vault' ? 'stored by the last SessionStart' : 'from this configuration'})`,
      `total: ${status.total}`,
      'counts by type:',
      ...Object.entries(status.counts_by_type).map(
        ([type, count]) => `  ${type}: ${count}`,
      ),
      `oldest last-use age: ${formatAge(status.oldest_last_use_age_ms)}`,
      `expired tokens remembered: ${status.expired_tokens}`,
    ]);
    return;
  }
  if (action === 'clear') {
    if (!args.yes) {
      throw new Error(
        'vault clear removes every stored value of this project: add --yes to confirm (/zeroh-disclosure:settings vault clear --yes)',
      );
    }
    if (!(await authorized([`  project: ${cwd}`]))) return;
    const result = clearProject(cwd);
    print({ project: cwd, ...result }, args.json, [
      result.cleared
        ? `Cleared the vault for ${cwd}: ${result.values} stored value(s) removed.`
        : `No vault for ${cwd}; nothing stored to clear.`,
      `Also removed ${result.runFiles} pending restore file(s) and ${result.commitmentKeys} receipt commitment key(s).`,
    ]);
    return;
  }
  throw new Error('vault requires "status" or "clear"');
}

// `vault clear`: every stored value of the project, the restore files that
// still hold values (ZEROH_HOME/run) and the keys behind the receipts'
// commitments, so nothing the user asked to remove stays readable.
function clearProject(root) {
  let vault;
  try {
    vault = new Vault(root);
  } catch (error) {
    if (
      ![
        'ZEROH_VAULT_UNREADABLE',
        'ZEROH_VAULT_KEY_MISSING',
        'ZEROH_VAULT_KEY_INVALID',
      ].includes(error.code)
    ) {
      throw error;
    }
    // Nothing in it can be read: it goes (a lost key: every vault goes, as
    // with doctor --fix), then it is cleared like any other.
    resetVaults({ projectRoot: root });
    vault = new Vault(root);
  }
  const values = vault.size;
  const cleared = vault.clear();
  let runFiles = 0;
  try {
    runFiles = cleanupStaleRunFiles({ maxAgeMs: 0 });
  } catch {
    // Reported as zero; SessionStart removes what is left.
  }
  const commitmentKeys = pruneCommitmentKeys(root);
  return { cleared, values, runFiles, commitmentKeys };
}

function formatAge(ageMs) {
  if (ageMs === null) return '-';
  const seconds = Math.floor(ageMs / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}
