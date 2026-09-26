#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// /zeroh-disclosure:report: the slip for a period (7d, 30d, 90d or all).
import { loadConfig } from '../../lib/config.js';
import { buildReportForOptions, formatLocalReport } from '../../lib/report.js';
import { commandRoot } from './_helpers.js';

const since = process.argv[2] || '7d';
await loadConfig({ cwd: commandRoot() });
const report = await buildReportForOptions({ cwd: commandRoot(), since });
console.log(formatLocalReport(report));
