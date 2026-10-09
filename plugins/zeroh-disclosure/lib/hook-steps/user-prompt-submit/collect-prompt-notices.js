// SPDX-License-Identifier: AGPL-3.0-only

import { applyFirstRunDefaults } from '../../first-run.js';
import { uncertainMode } from '../../../packages/zeroh-disclosure-core/config.js';
import {
  activeGrants,
  formatStatusline,
} from '../../../packages/zeroh-disclosure-core/unmask.js';
import {
  vaultProblem,
  zerohHome,
} from '../../../packages/zeroh-disclosure-core/vault.js';
import { maskedAgainLine } from '../../../packages/zeroh-disclosure-core/protection-state.js';
const GRANT_REMINDER_MS = 5 * 60 * 1000;

export function collectPromptNotices(
  state,
  { vaultFailure, routingNotice, root, sessionId, endedGrantKinds },
) {
  // Claude Code applies these settings to the running session once it watches
  // the file, so the first prompt sets them rather than SessionStart.
  const lines = [...applyFirstRunDefaults({ home: zerohHome() }).lines];
  if (vaultFailure && !state.vaultNoticeShown) {
    const problem = vaultProblem(vaultFailure);
    lines.push(
      `⚠ ZeroH Disclosure can't open its vault for this project: ${problem.reason}. ${
        uncertainMode() === 'block'
          ? 'Tool output is withheld and tool calls are stopped until that is fixed.'
          : 'Until that is fixed nothing can be masked: tool output goes to Claude as it is, with a "not protected" line.'
      } ${problem.fix}`,
    );
    state.vaultNoticeShown = true;
  }
  if (routingNotice && !state.routingNoticeShown) {
    lines.push(routingNotice);
    state.routingNoticeShown = true;
  }
  const grants = activeGrants(root, { sessionId });
  const seen = { ...(state.grantNotices ?? {}) };
  const now = Date.now();
  for (const grant of grants) {
    const left =
      grant.expires_at == null ? Infinity : Date.parse(grant.expires_at) - now;
    if (!seen[grant.id] || left <= GRANT_REMINDER_MS) {
      lines.push(formatStatusline([grant], now));
    }
    seen[grant.id] = { kind: grant.kind };
  }
  for (const [id, { kind }] of Object.entries(seen)) {
    if (grants.some((grant) => grant.id === id)) continue;
    lines.push(maskedAgainLine(kind));
    endedGrantKinds.push(kind);
    delete seen[id];
  }
  state.grantNotices = seen;
  return lines.join('\n');
}
