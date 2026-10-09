// SPDX-License-Identifier: AGPL-3.0-only

import {
  ALLOW_FILE_NOTICE,
  allowRuleKey,
  readAllowRules,
  updateAllowRule,
  writeAllowRules,
} from '../../packages/zeroh-disclosure-core/allow-rules.js';
import {
  destinationSummary,
  formatDestinationSummary,
} from '../../packages/shell-analysis/allow-list.js';
import { loadKnownSecrets } from '../../packages/shell-analysis/secrets.js';
import { Vault } from '../../packages/zeroh-disclosure-core/vault.js';
import { authorized, print } from './shared.js';

export async function cmdAllow(args, cwd) {
  const loaded = readAllowRules(cwd);
  const remove = typeof args.remove === 'string';
  // `/zeroh-disclosure:allow` with no arguments lists, like --list.
  // The vault's values, for a typed value's token (Mac /try review M1).
  let held = [];
  try {
    const vault = new Vault(cwd);
    vault.load();
    held = vault.knownValues();
  } catch {
    // No vault (or a locked one): names, types and tokens still work.
  }
  if (args.list || (!remove && args._.length === 1)) {
    if (loaded.ignored) console.error(ALLOW_FILE_NOTICE);
    const summary = destinationSummary(loadKnownSecrets(cwd), loaded.rules, {
      typed: held.filter((entry) => entry.source === 'prompt'),
    });
    print({ rules: loaded.rules, ...summary }, args.json, [
      ...formatDestinationSummary(summary),
    ]);
    return;
  }

  const name = remove ? args.remove : args._[1];
  const host = remove ? args._[1] : args._[2];
  if (!name || !host) {
    throw new Error(
      remove
        ? 'allow --remove requires <NAME|TOKEN|TYPE> <host|mcp:SERVER>'
        : 'allow requires <NAME|TOKEN|TYPE> <host|mcp:SERVER>',
    );
  }
  const key = allowRuleKey(name, { values: held });
  const rules = updateAllowRule(loaded.rules, key, host, { remove });
  if (!(await authorized())) return;
  writeAllowRules(cwd, rules);
  const action = remove ? 'removed' : 'allowed';
  print({ action, name: key, host, rules }, args.json, [
    `${action}: ${key} → ${host}`,
    ...(remove ? [] : ['Ask Claude to try again.']),
  ]);
}
