// SPDX-License-Identifier: AGPL-3.0-only

import {
  deleteReport,
  listReports,
  readReport,
} from '../../packages/zeroh-disclosure-core/report-miss.js';
import {
  deleteProxyReport,
  formatProxyReport,
  isProxyReportId,
  listProxyReports,
  readProxyReport,
} from '../../packages/local-proxy/proxy-report.js';
import { authorized, print } from './shared.js';

export async function cmdReports(args) {
  const action = args._[1] || 'list';
  if (action === 'list') {
    // Missed-value reports and proxy diagnostic reports share the folder;
    // each line says which kind it is.
    const reports = listReports().map((report) => ({
      kind: 'miss',
      ...report,
    }));
    const proxyReports = listProxyReports().map((report) => ({
      kind: 'proxy',
      id: report.id,
      date: report.date,
      event: report.event,
      failure: report.failure,
    }));
    const all = [...reports, ...proxyReports].sort((left, right) =>
      String(right.date).localeCompare(String(left.date)),
    );
    print(
      { reports: all },
      args.json,
      all.length
        ? all.map((report) =>
            report.kind === 'proxy'
              ? `${report.id}  ${report.date}  proxy  ${report.event}${report.failure ? ` (${report.failure})` : ''}`
              : `${report.id}  ${report.date}  miss  ${report.shape?.public_prefix || '-'}  ${report.shape?.length ?? '-'} chars  ${report.where}`,
          )
        : ['No local reports.'],
    );
    return;
  }
  const id = args._[2];
  if (!id) throw new Error(`reports ${action} requires <id>`);
  // Deleting a local report is the user's (/zeroh-disclosure:report-miss
  // delete <id>).
  if (action === 'delete' && !(await authorized())) return;
  if (isProxyReportId(id)) {
    if (action === 'show') {
      print(readProxyReport(id), args.json, [
        formatProxyReport(readProxyReport(id)),
      ]);
      return;
    }
    if (action === 'delete') {
      const deleted = deleteProxyReport(id);
      print({ id, deleted }, args.json, [
        deleted ? `Deleted local report ${id}.` : `Report not found: ${id}.`,
      ]);
      return;
    }
  }
  if (action === 'show') {
    const report = readReport(id);
    print(report, args.json, [JSON.stringify(report, null, 2)]);
    return;
  }
  if (action === 'delete') {
    const deleted = deleteReport(id);
    print({ id, deleted }, args.json, [
      deleted ? `Deleted local report ${id}.` : `Report not found: ${id}.`,
    ]);
    return;
  }
  throw new Error(`unknown reports action: ${action}`);
}
