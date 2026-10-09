// SPDX-License-Identifier: AGPL-3.0-only

import {
  formatSessionTokenMap,
  sessionTokenMap,
} from '../../packages/zeroh-disclosure-core/report.js';

export async function cmdTokens(args, cwd) {
  const result = await sessionTokenMap({
    projectRoot: cwd,
    sessionId: args.session || null,
  });
  console.log(formatSessionTokenMap(result.rows, { previews: true }));
}
