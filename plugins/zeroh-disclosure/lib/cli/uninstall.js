// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';

import { terminalCommand } from '../../packages/zeroh-disclosure-core/fix-command.js';
import { zerohHome } from '../../packages/zeroh-disclosure-core/vault.js';
import { notAZerohHome } from './legacy-projects.js';
import { executeUninstall } from './uninstall-execute.js';
import { prepareUninstall } from './uninstall-plan.js';
import { renderUninstall } from './uninstall-render.js';
import { authorized, print } from './shared.js';

export async function cmdUninstall(args) {
  const home = path.resolve(zerohHome());
  const unsafe = notAZerohHome(home);
  if (unsafe) {
    throw new Error(
      `${home} ${unsafe}, so uninstall leaves it alone. Check ZEROH_HOME; nothing was removed.`,
    );
  }
  const context = await prepareUninstall(args, home);
  if (!args.yes || args['dry-run']) {
    print({ plan: context.plan, removed: [] }, args.json, [
      ...context.plan,
      '',
      'Nothing was removed yet. To remove all of it, type /zeroh-disclosure:uninstall',
      `(in a terminal: ${terminalCommand(['uninstall', '--yes'])}).`,
    ]);
    return;
  }
  if (!(await authorized(context.plan))) return;
  const result = await executeUninstall(home, context);
  renderUninstall(args, home, context, result);
}
