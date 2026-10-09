// SPDX-License-Identifier: AGPL-3.0-only

import {
  loadConfig,
  uncertainMode,
} from '../../../packages/zeroh-disclosure-core/config.js';
import {
  commandRunsZeroHManagement,
  commandRunsZeroHPresentation,
  commandRunsClaudeControlCli,
  claudeControlChangeReason,
  deniesElicitationHookEdits,
  deniesUserOnlyCommand,
  deniesZeroHSettings,
  managementDenyReason,
  protectedShellDecision,
  SETTINGS_DENY_REASON,
  USER_ONLY_DENY_REASON,
  VERIFIED_CLI,
} from '../../../packages/shell-analysis/settings-guard.js';
import { shellOf } from '../../../packages/shell-analysis/shell-tools.js';
import { subjectOf } from './describe-tool-use.js';

export async function guardToolSettings({
  toolName,
  toolInput,
  root,
  commandCwd,
  cwd,
  styleKey,
  bannerModes,
  passUnchecked,
  emitDeny,
}) {
  let configFailed = false;
  try {
    configFailed = (await loadConfig({ cwd })).unreadable?.length > 0;
  } catch {
    configFailed = true;
  }
  const mode = uncertainMode(process.env);
  const presentation =
    typeof toolInput.command === 'string' &&
    commandRunsZeroHPresentation(
      toolInput.command,
      shellOf(toolName),
      commandCwd,
      styleKey,
      bannerModes,
    );
  const guardOptions = {
    mode,
    // Path guards resolve shell targets here; root remains the policy/session
    // root even when the event runs from a project's .claude subdirectory.
    commandCwd: commandCwd || cwd,
    styleKey,
    bannerModes,
    presentationCliPath: presentation ? VERIFIED_CLI : null,
  };
  if (deniesUserOnlyCommand(toolName, toolInput)) {
    // deny-inventory: user-only-command
    emitDeny(USER_ONLY_DENY_REASON);
    return { exit: true, mode };
  }
  if (toolName === 'Skill' || toolName === 'SlashCommand') {
    return { exit: true, mode };
  }
  if (deniesElicitationHookEdits(toolName, toolInput, root)) {
    // deny-inventory: elicitation-hook
    emitDeny(
      'ZeroH Disclosure blocked an attempt to add or change an Elicitation hook. Unmask consent must be answered by the user in Claude Code.',
    );
    return { exit: true, mode };
  }
  const shell = shellOf(toolName);
  if (shell && typeof toolInput.command === 'string') {
    if (commandRunsZeroHManagement(toolInput.command, shell)) {
      // deny-inventory: management-cli
      emitDeny(managementDenyReason(toolInput.command, shell));
      return { exit: true, mode };
    }
    if (!commandRunsClaudeControlCli(toolInput.command)) {
      const decision = protectedShellDecision(
        toolName,
        toolInput,
        root,
        guardOptions,
      );
      if (decision.deny) {
        // deny-inventory: protected-path-write
        emitDeny(decision.reason);
        return { exit: true, mode };
      }
      if (decision.unchecked) await passUnchecked(decision.unchecked);
    }
  }
  const claudeReason = claudeControlChangeReason(
    toolName,
    toolInput,
    root,
    guardOptions,
  );
  if (claudeReason) {
    // deny-inventory: claude-control
    emitDeny(claudeReason);
    return { exit: true, mode };
  }
  if (deniesZeroHSettings(toolName, toolInput, root, guardOptions)) {
    // deny-inventory: zeroh-settings
    emitDeny(SETTINGS_DENY_REASON);
    return { exit: true, mode };
  }
  if (configFailed) {
    if (mode === 'block') {
      // deny-inventory: config-unreadable
      emitDeny(
        '🛡  ZeroH Disclosure denied this tool call because it could not read its configuration (.zeroh.env). Ask the user to fix or remove that file.',
      );
      return { exit: true, mode };
    }
    await passUnchecked('config-unreadable', {
      subject: subjectOf(toolName),
    });
  }
  return { exit: false, mode };
}
