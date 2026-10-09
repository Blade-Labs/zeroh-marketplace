// SPDX-License-Identifier: AGPL-3.0-only

import { deleteValuesFile } from '../../../packages/shell-analysis/late-bind.js';

// The late-binding values file is normally removed by the command itself; this
// is the fallback. A failure here must not stop the output from being masked.
export function cleanupValuesFile(event) {
  if (!event?.session_id || !event?.tool_use_id) return;
  try {
    deleteValuesFile({
      sessionId: event.session_id,
      toolUseId: event.tool_use_id,
    });
  } catch {
    // The stale-file sweep at Stop removes it later.
  }
}
