#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// /zeroh-disclosure:mask-show: which tokens the model saw this session, without
// values (previews stay in the terminal: zeroh-disclosure tokens).
import { formatSessionTokenMap, sessionTokenMap } from '../../lib/report.js';
import { commandRoot, commandSessionId } from './_helpers.js';

const result = await sessionTokenMap({
  projectRoot: commandRoot(),
  sessionId: commandSessionId(),
});
console.log(formatSessionTokenMap(result.rows));
