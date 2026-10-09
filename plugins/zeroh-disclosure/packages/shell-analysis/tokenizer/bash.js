// SPDX-License-Identifier: AGPL-3.0-only

import { ShellParseError } from './bash-core.js';
import { parseSequence } from './bash-sequence.js';

export function parseBash(source) {
  try {
    const { commands } = parseSequence(String(source ?? ''), 0, null, 0, 'top');
    return { ok: true, commands };
  } catch (error) {
    if (error instanceof ShellParseError)
      return { ok: false, reason: error.message, commands: [] };
    throw error;
  }
}

// A program's name as the guards compare it: the basename, without `.exe`
// (or `.cmd`, `.bat`, `.com`), in lower case.
