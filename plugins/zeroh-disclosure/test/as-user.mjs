// SPDX-License-Identifier: AGPL-3.0-only

// Tests run a state-changing CLI subcommand as the user would: with the
// one-time ticket the UserPromptSubmit hook mints for the user's own typed
// slash command (lib/user-authority.js). A read-only subcommand gets nothing.
import {
  managementAction,
  mintTicket,
  TICKET_ENV,
} from '../lib/user-authority.js';

// The environment `args` needs, added to `env` (which must name the same
// ZEROH_HOME as the child's).
export function asUser(args, env = process.env) {
  return managementAction(args)
    ? { ...env, [TICKET_ENV]: mintTicket({ argv: args, env }) }
    : env;
}
