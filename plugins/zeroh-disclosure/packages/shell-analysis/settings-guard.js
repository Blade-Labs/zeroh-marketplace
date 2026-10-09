// SPDX-License-Identifier: AGPL-3.0-only

export {
  SETTINGS_DENY_REASON,
  SHELL_TOOLS,
  STATUSLINE_STYLE_FILE,
  USER_ONLY_COMMANDS,
  USER_ONLY_DENY_REASON,
  deniesClaudeBaseUrlMutation,
  deniesElicitationHookEdits,
  deniesUserOnlyCommand,
  deniesZeroHSettings,
  isZeroHSettingsPath,
  textReferencesZeroHSettings,
} from './guard/protected-paths.js';
export {
  PROTECTED_SHELL_BLOCK_REASON,
  PROTECTED_SHELL_DENY_REASON,
} from './guard/explicit-writes.js';
export {
  isReadOnlyInspection,
  protectedShellDecision,
} from './guard/plain-safe-reads.js';
export {
  CLI_LAUNCHERS,
  MANAGEMENT_DENY_REASON,
  STATUSLINE_DENY_REASON,
  USER_ONLY_CLI_DENY_REASON,
  VERIFIED_CLI,
  ZEROH_MANAGEMENT_SUBCOMMANDS,
  commandZeroHManagementKind,
  commandRunsZeroHManagement,
  commandRunsZeroHPresentation,
  managementDenyReason,
} from './guard/management.js';
export {
  claudeControlChangeReason,
  claudeControlKind,
  commandRunsClaudeControlCli,
  deniesClaudeControlChange,
  settingsChangeWeakensZeroH,
} from './guard/claude-control.js';
