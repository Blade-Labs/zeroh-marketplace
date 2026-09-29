#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// PostToolUseFailure and PermissionDenied for Bash and PowerShell: the command
// was interrupted, failed before it could remove its late-binding values file,
// or never ran (Claude Code 2.1.283 sends PermissionDenied when auto mode's
// classifier refuses a call). Its values file goes now rather than at the
// turn's end. A refusal no hook hears about (a headless run that cannot ask,
// a person saying no) is covered at Stop, UserPromptSubmit and SessionEnd
// (lib/late-bind.js cleanupSessionRunFiles). Says nothing: the tool result
// already tells the model what happened.
import { readStdinJson } from '../lib/hook-io.js';
import { deleteValuesFile } from '../lib/late-bind.js';

const event = await readStdinJson();
if (event?.session_id && event?.tool_use_id) {
  try {
    deleteValuesFile({
      sessionId: event.session_id,
      toolUseId: event.tool_use_id,
    });
  } catch {
    // The turn-end sweep removes it.
  }
}
