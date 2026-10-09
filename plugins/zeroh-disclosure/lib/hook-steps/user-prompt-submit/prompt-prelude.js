// SPDX-License-Identifier: AGPL-3.0-only

import {
  loadConfig,
  uncertainMode,
} from '../../../packages/zeroh-disclosure-core/config.js';
import {
  recordUnchecked,
  uncheckedNotice,
} from '../../../packages/zeroh-disclosure-core/unchecked.js';
import {
  emit,
  markPromptCleared,
  markSideEffect,
  projectDir,
  stopPrompt,
} from '../../hook-io.js';
import {
  handleManagementPrompt,
  isManagementPrompt,
} from '../../../packages/zeroh-disclosure-core/user-authority.js';
import { isUninstalled } from '../../../packages/zeroh-disclosure-core/uninstall-marker.js';

export const MAX_CHECKED_PROMPT_BYTES = 256 * 1024;

export async function passPromptUnchecked(event, reason, suffix = '') {
  let notice = null;
  try {
    ({ notice } = await recordUnchecked({
      reason,
      tool: 'UserPromptSubmit',
      cwd: projectDir(event),
      sessionId: event?.session_id,
      subject: 'prompt',
    }));
  } catch {
    // recordUnchecked normally does not throw; the fallback still shows.
  }
  return `${notice ?? uncheckedNotice(reason, { subject: 'prompt' })}${suffix}`;
}

export async function handlePromptPrelude({ event, userPrompt }) {
  if (Buffer.byteLength(userPrompt) > MAX_CHECKED_PROMPT_BYTES) {
    let pass = true;
    try {
      await loadConfig({ cwd: projectDir(event) });
      pass = uncertainMode() === 'pass';
    } catch {
      pass = true;
    }
    if (pass) {
      markPromptCleared();
      emit({ systemMessage: await passPromptUnchecked(event, 'too-large') });
      return true;
    }
    // deny-inventory: prompt-too-large
    stopPrompt(
      `🛡 ZeroH stopped this prompt: it is larger than ${MAX_CHECKED_PROMPT_BYTES / 1024} KB and could not be checked in time. Put the text in a file and ask Claude to read it: what it reads is masked.`,
    );
    return true;
  }

  let managed = null;
  try {
    managed = handleManagementPrompt({
      prompt: userPrompt,
      sessionId: event?.session_id,
      cwd: projectDir(event),
      markSideEffect,
    });
  } catch {
    if (isManagementPrompt(userPrompt)) {
      managed = {
        message:
          'Nothing changed: ZeroH could not check this request. Type the command again; if it keeps happening, run /zeroh-disclosure:doctor.',
      };
    }
  }
  if (managed) {
    // deny-inventory: management-request
    stopPrompt(managed.message);
    return true;
  }
  return isUninstalled();
}
