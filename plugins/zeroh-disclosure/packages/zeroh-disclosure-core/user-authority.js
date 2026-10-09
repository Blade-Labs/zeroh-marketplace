// SPDX-License-Identifier: AGPL-3.0-only

export {
  DONE_LINE,
  PENDING_TTL_MS,
  TICKET_ENV,
  TICKET_TTL_MS,
  authzDir,
  canonicalArgv,
  claimPending,
  insideClaudeCode,
  managementAction,
  mintTicket,
  openTerminal,
  parseSlashPrompt,
  processAncestry,
  recordPending,
  requireUserAuthority,
  runAsUser,
  slashFor,
  slashToCli,
  splitArguments,
} from './user-authority/authority.js';
export {
  beginRemoval,
  commitRemoval,
  failRemoval,
  finishRemoval,
  markRemovalCleanupStarted,
  startRemovalHeartbeat,
  stopRemovalHeartbeat,
} from './user-authority/removal.js';
export {
  handleManagementPrompt,
  isManagementPrompt,
} from './user-authority/remaining-steps.js';
