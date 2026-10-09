// SPDX-License-Identifier: AGPL-3.0-only

import {
  buildReportForOptions,
  formatLocalReport,
  renderReportHtml,
  writeLocalReport,
} from '../../packages/zeroh-disclosure-core/report.js';
import { readStyle } from '../statusline.js';

const FORMATS = new Set(['text', 'json', 'html']);

export async function cmdReport(args, cwd) {
  if (args.json === true) throw new Error('--json requires a path');
  const report = await buildReportForOptions({
    cwd,
    since: args.since || '7d',
    project: args.project || '.',
    allProjects: !!args['all-projects'],
  });
  const written = await writeLocalReport({
    report,
    htmlPath: args.html || null,
    jsonPath: typeof args.json === 'string' ? args.json : null,
  });
  const style = readStyle();
  const exported = Boolean(args.html || typeof args.json === 'string');
  const format = args.format || (exported ? 'text' : style.reportFormat);
  if (!FORMATS.has(format))
    throw new Error('--format must be text, json, or html');
  if (format === 'json') console.log(JSON.stringify(report, null, 2));
  else if (format === 'html') console.log(renderReportHtml(report));
  else
    console.log(
      formatLocalReport(report, written, { verbosity: style.verbosity }),
    );
}
