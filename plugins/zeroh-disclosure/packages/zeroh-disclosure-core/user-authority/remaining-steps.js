// SPDX-License-Identifier: AGPL-3.0-only

import { isUninstalled } from '../uninstall-marker.js';
import { PUBLIC_PLUGIN_ID } from '../product.js';
import {
  claimPending,
  DONE_LINE,
  parseSlashPrompt,
  runAsUser,
  slashFor,
  slashToCli,
} from './authority.js';
import { startDetachedRemoval } from './removal.js';

// True when the typed prompt is one of ZeroH's own (namespaced) management
// slash commands. Never throws.
export function isManagementPrompt(prompt) {
  try {
    const slash = parseSlashPrompt(prompt);
    return Boolean(
      slash?.namespaced &&
      (slashToCli(slash.name, slash.args) ||
        (slash.name === 'allow' && slash.args.length === 0)),
    );
  } catch {
    return false;
  }
}

// For a typed prompt that is one of the management slash commands: applies
// it when its `!` block recorded the same request in this session, and
// returns the message to show; null for any other prompt.
export function handleManagementPrompt({
  prompt,
  sessionId,
  cwd,
  env = process.env,
  // lib/hook-io.js markSideEffect: a timeout mid-change then says so.
  markSideEffect = () => {},
}) {
  const slash = parseSlashPrompt(prompt);
  if (!slash) return null;
  if (slash.namespaced && slash.name === 'allow' && slash.args.length === 0) {
    const listed = runAsUser({
      argv: ['allow'],
      cwd,
      timeoutMs: 6_000,
      env: {
        ...env,
        CLAUDE_CODE_SESSION_ID: sessionId || '',
        CLAUDE_PROJECT_DIR: cwd,
      },
    });
    if (listed.timedOut || listed.status !== 0) {
      return {
        applied: false,
        message:
          'Nothing changed: ZeroH could not list allowed destinations. Run /zeroh-disclosure:doctor if it keeps happening.',
      };
    }
    return {
      applied: true,
      message: `${DONE_LINE} ${listed.output || 'Allowed destinations listed.'}`,
    };
  }
  if (
    slash.namespaced &&
    slash.name === 'uninstall' &&
    slash.args.includes('--dry-run') &&
    isUninstalled(env)
  ) {
    return {
      applied: false,
      message:
        'Nothing changed: ZeroH is already removed. The dry run has no remaining local cleanup to show.',
    };
  }
  const argv = slashToCli(slash.name, slash.args);
  if (!argv) return null;
  const pending = claimPending({ argv, sessionId, env });
  if (!pending) {
    // The short form may be another plugin's or a built-in command: only
    // ZeroH's own namespaced command is answered here.
    if (!slash.namespaced) return null;
    return {
      applied: false,
      message: `Nothing changed: ZeroH found no matching request for ${slashFor(argv)} (it expires after a minute, and must be typed exactly as the command received it). Type it again.`,
    };
  }
  markSideEffect(`running ${slashFor(argv)}`);
  if (argv[0] === 'uninstall') {
    let log;
    try {
      log = startDetachedRemoval({
        argv,
        cwd,
        onLog: (file) =>
          markSideEffect(`running ${slashFor(argv)}; log: ${file}`),
        env: {
          ...env,
          CLAUDE_CODE_SESSION_ID: sessionId || '',
          CLAUDE_PROJECT_DIR: cwd,
        },
      });
    } catch (error) {
      markSideEffect(null);
      return { applied: false, message: `Nothing changed: ${error.message}` };
    }
    markSideEffect(null);
    return {
      applied: true,
      message: `${DONE_LINE} ZeroH Disclosure removal is running in the background. Read its log: ${log}. If the log is gone, every removal step finished. If it remains, follow the Remaining steps at its end; if it says "local cleanup failed", type /zeroh-disclosure:uninstall again. Check \`claude plugin list\`; if the plugin remains after local cleanup, run \`claude plugin uninstall ${PUBLIC_PLUGIN_ID}\`.`,
    };
  }
  const run = runAsUser({
    argv,
    cwd,
    timeoutMs: 6_000,
    env: {
      ...env,
      CLAUDE_CODE_SESSION_ID: sessionId || '',
      CLAUDE_PROJECT_DIR: cwd,
    },
  });
  markSideEffect(null);
  if (run.timedOut) {
    return {
      applied: false,
      message: `ZeroH started ${slashFor(argv)} and it was still finishing when the wait ended. Run /zeroh-disclosure:doctor to check the current state.`,
    };
  }
  const applied =
    run.status === 0 && !/^(?:Nothing changed|Cancelled)/u.test(run.output);
  // Claude Code shows this under "operation blocked by hook": the command
  // ran here and is not sent to the model, so the first line says it is done.
  return {
    applied,
    message: applied
      ? `${DONE_LINE} ${run.output || slashFor(argv)}`
      : run.output || `Nothing changed: ${slashFor(argv)} failed.`,
  };
}
