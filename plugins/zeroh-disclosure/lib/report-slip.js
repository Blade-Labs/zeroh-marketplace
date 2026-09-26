// SPDX-License-Identifier: AGPL-3.0-only

// The receipt slip: one data model (sessionSlip, reportSlip) and its 44-column
// terminal rendering, plus the other terminal texts of `receipt`, `report` and
// `tokens`. No file I/O; lib/report.js gathers the data and lib/report-html.js
// renders the same slip as a paper card.
import { terminalCommand } from './fix-command.js';
import { displayPath } from './private-fs.js';
import { decodeCompactReceipt } from './selective-disclosure.js';
import {
  countLabel,
  formatNotice,
  isPersonalType,
  mergedCounts,
  rows,
  sumCounts,
} from './report-counts.js';

export const LOCAL_SUMMARY_NOTICE =
  'This is a local summary of evidence stored on this machine.';

export const PREMIUM_NOTICE =
  'ProofPack reports for auditors are planned for Premium (waitlist).';

export const REPORT_TITLE = 'ZeroH Disclosure · Receipt';

export const RECEIPT_WIDTH = 44;

export const TOKEN_MAP_COMMAND = '/zeroh-disclosure:mask-show';

// User-facing names for the local signing key. The slip names the key, not
// the receipt format (lib/selective-disclosure.js createSignedReceipt).
const SIGNING_LABELS = { ES256: 'ECDSA P-256' };

export const SINCE_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

export function previewValue(type, value) {
  const text = String(value ?? '');
  if (text.length <= 8) return '•••';
  if (type === 'EMAIL') {
    const at = text.lastIndexOf('@');
    if (at > 0 && at < text.length - 1) {
      return `${text[0]}…@${text.slice(at + 1)}`;
    }
  }
  if (isPersonalType(type)) return `${type} …${text.slice(-2)}`;
  if (text.length < 20) return `${text.slice(0, 4)}…`;
  return `${text.slice(0, 7)}…${text.slice(-4)}`;
}

// The value previews go only to the user's terminal (`zeroh-disclosure tokens`)
// and receipt.html. /zeroh-disclosure:mask-show loads its output into the
// model's context, so it uses the default: token, type, source and count.
export function formatSessionTokenMap(rows, { previews = false } = {}) {
  const lines = ['ZeroH Disclosure — what the model saw this session'];
  if (!rows.length) return `${lines[0]}\nNo sensitive values this session.`;
  lines.push(
    '',
    previews
      ? 'The model saw | Type | From | Your value | First seen | Count'
      : 'The model saw | Type | From | First seen | Count',
    previews
      ? '--- | --- | --- | --- | --- | ---'
      : '--- | --- | --- | --- | ---',
  );
  for (const row of rows) {
    lines.push(
      [
        row.token,
        row.type,
        row.from,
        ...(previews ? [row.preview] : []),
        `turn ${row.first_seen_turn}`,
        row.count,
      ].join(' | '),
    );
  }
  if (!previews)
    lines.push(
      '',
      `Value previews are shown only in your terminal: ${terminalCommand(['tokens'])}`,
    );
  return lines.join('\n');
}

export function formatReceiptSummary(result) {
  const lines = [formatSlipText(result.slip)];
  const unchecked = uncheckedTerminalLines(
    mergedCounts(result.summaries.map((item) => item.formats_passed_unmasked)),
  );
  if (unchecked.length) lines.push('', ...unchecked);
  lines.push(
    '',
    result.receipt_html
      ? `receipt.html: ${displayPath(result.receipt_html)}`
      : 'receipt.html: written when the turn ends',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The slip. One data model, rendered as 44-column text and as a paper card.
//
// withheld: every occurrence of a detected value that was replaced by a token
//   before it reached the model (typed prompt replacements plus tool-output
//   replacements recorded in audit.masked.by_type), summed over the type rows
//   shown on the slip. The slip computes it from its own rows so the total and
//   the rows can never disagree.
// sent: detected values that reached the model in plain text. Today that is
//   only values revealed under an unmask grant the user approved
//   (receipt.revealed_under_grant[].values, written when a grant reveals values; missing means 0). Formats that pass
//   unchecked (images, scanned PDFs) were never detected, so they are not
//   counted as sent; the slip lists them separately as "passed unchecked".
// ---------------------------------------------------------------------------

export function sessionSlip(summaries, { turn = null } = {}) {
  const dates = summaries.map((item) => item.date).filter((d) => d !== '-');
  const first = dates[0] ?? '-';
  const last = dates.at(-1) ?? first;
  const date = first === last ? first : `${first} – ${last}`;
  const latest = summaries.at(-1);
  return {
    eyebrow: turn == null ? 'RECEIPT · SESSION' : `RECEIPT · TURN ${turn}`,
    title: REPORT_TITLE,
    meta:
      turn == null
        ? `${date} · ${countLabel(summaries.length, 'turn')}`
        : `${date} · turn ${turn}`,
    rows: slipRows(mergedCounts(summaries.map((item) => item.masked_by_type))),
    sent: summaries.reduce((sum, item) => sum + item.values_sent, 0),
    unchecked_files: sumCounts(
      mergedCounts(summaries.map((item) => item.formats_passed_unmasked)),
    ),
    receipt_id: latest?.receipt_id ?? '-',
    signing: latest?.signing ?? null,
    verified: summaries.filter((item) => item.verified).length,
    receipts: summaries.length,
    failed_checks: [
      ...new Set(summaries.flatMap((item) => item.failed_checks ?? [])),
    ],
  };
}

export function reportSlip(report) {
  const totals = report.totals;
  const label = periodLabel(report.period, report.generated_at);
  return {
    eyebrow: `RECEIPT · ${label.toUpperCase()}`,
    title: REPORT_TITLE,
    meta: [
      label,
      countLabel(totals.sessions ?? 0, 'session'),
      countLabel(totals.turns ?? 0, 'turn'),
    ].join(' · '),
    rows: slipRows(
      Object.fromEntries(
        report.masked_by_type.map((entry) => [entry.type, entry.count]),
      ),
    ),
    sent: totals.values_sent,
    unchecked_files: totals.files_passed_unchecked ?? 0,
    receipt_id: report.latest_receipt_id ?? '-',
    signing: report.latest_receipt_signing ?? null,
    verified: totals.receipts_verified,
    receipts: totals.receipts_found,
  };
}

export function slipLines(slip) {
  const withheld = slip.rows.reduce((sum, row) => sum + row.count, 0);
  const lines = [
    { kind: 'eyebrow', text: slip.eyebrow },
    { kind: 'title', text: slip.title },
    { kind: 'meta', text: slip.meta },
    { kind: 'dash' },
  ];
  if (slip.rows.length) {
    for (const row of slip.rows) {
      lines.push({ kind: 'item', label: row.type, value: `×${row.count}` });
    }
  } else {
    lines.push({ kind: 'empty', text: 'no sensitive values' });
  }
  lines.push(
    { kind: 'solid' },
    { kind: 'total', label: 'withheld', value: String(withheld) },
    {
      kind: slip.sent === 0 ? 'sent-zero' : 'sent',
      label: 'values sent to Claude',
      value: String(slip.sent),
    },
  );
  if (slip.sent > 0) {
    lines.push({
      kind: 'note',
      text: `shown under grants you approved: ${slip.sent}`,
    });
  }
  if (slip.unchecked_files > 0) {
    lines.push({
      kind: 'muted',
      text: `passed unchecked: ${countLabel(slip.unchecked_files, 'file')} (see below)`,
      anchor: 'unchecked',
    });
  }
  lines.push({ kind: 'dash' });
  if (slip.receipt_id && slip.receipt_id !== '-') {
    lines.push({ kind: 'footer', text: `receipt ${slip.receipt_id}` });
  }
  lines.push({
    kind: 'footer',
    text: slip.signing
      ? `signed on this laptop · ${slip.signing}`
      : 'signed on this laptop',
  });
  lines.push({
    kind: 'footer',
    text:
      slip.receipts === 0
        ? 'no signed receipts yet'
        : `${slip.verified === slip.receipts ? '✓' : '✗'} verified ${slip.verified} of ${slip.receipts}`,
  });
  if (slip.failed_checks?.length) {
    lines.push({
      kind: 'footer',
      text: `failed check: ${slip.failed_checks.join(', ')}`,
    });
  }
  lines.push({ kind: 'footer', text: TOKEN_MAP_COMMAND });
  return lines;
}

export function formatSlipText(slip) {
  const out = [];
  for (const line of slipLines(slip)) {
    if (line.kind === 'dash')
      out.push('- '.repeat(RECEIPT_WIDTH / 2).trimEnd());
    else if (line.kind === 'solid') out.push('─'.repeat(RECEIPT_WIDTH));
    else if (line.label != null) out.push(textRow(line.label, line.value));
    else out.push(...wrapText(line.text));
  }
  return out.join('\n');
}

export function textRow(label, value) {
  const room = RECEIPT_WIDTH - value.length - 1;
  const name = label.length > room ? `${label.slice(0, room - 1)}…` : label;
  return `${name}${' '.repeat(RECEIPT_WIDTH - name.length - value.length)}${value}`;
}

export function wrapText(text, width = RECEIPT_WIDTH) {
  const lines = [];
  let rest = String(text);
  while (rest.length > width) {
    const cut = rest.lastIndexOf(' ', width);
    const at = cut > 0 ? cut : width;
    lines.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  lines.push(rest);
  return lines;
}

export function slipRows(counts) {
  // Secrets first, then personal data, like the till slip; biggest first.
  return rows(counts, 'type').sort(
    (left, right) =>
      Number(isPersonalType(left.type)) - Number(isPersonalType(right.type)) ||
      right.count - left.count ||
      left.type.localeCompare(right.type),
  );
}

export function uncheckedTerminalLines(counts) {
  const entries = rows(counts, 'format');
  if (!entries.length) return [];
  return [
    'passed unchecked (not scanned for values):',
    ...entries.flatMap((entry) =>
      wrapText(
        `${entry.format} ×${entry.count}. ${formatNotice(entry.format)}`,
        RECEIPT_WIDTH - 2,
      ).map((line) => `  ${line}`),
    ),
  ];
}

export function periodLabel(period, generatedAt) {
  const key = String(period?.label ?? '').toLowerCase();
  if (key === 'all') return 'all time';
  const days = SINCE_DAYS[key];
  if (!days) return key || 'all time';
  if (key !== '7d') return `last ${days} days`;
  // The weekly window is the last 7×24 hours, so it is labelled by the dates
  // it covers ("Sep 18–25"), never by a calendar week it may straddle.
  const range = dateRangeLabel(period?.start, period?.end ?? generatedAt);
  return range ?? 'last 7 days';
}

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// "Sep 18–25", "Sep 28–Oct 4" or "Dec 29, 2026–Jan 4, 2027", in local time.
export function dateRangeLabel(startValue, endValue) {
  const start = new Date(startValue ?? Number.NaN);
  const end = new Date(endValue ?? Number.NaN);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  const day = (date) => `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  if (start.getFullYear() !== end.getFullYear()) {
    return `${day(start)}, ${start.getFullYear()}–${day(end)}, ${end.getFullYear()}`;
  }
  if (start.getMonth() === end.getMonth()) {
    return `${day(start)}–${end.getDate()}`;
  }
  return `${day(start)}–${day(end)}`;
}

export function signingLabel(ledger) {
  try {
    const alg = decodeCompactReceipt(ledger?.receipt?.compact ?? '').header
      ?.alg;
    return SIGNING_LABELS[alg] ?? null;
  } catch {
    return null;
  }
}

// Unmask grants record each reveal on the turn receipt as receipt.revealed_under_grant:
// one entry per grant with the number of detected values shown in plain text
// (`values`) and the tool outputs they appeared in. The entries are covered by
// revealed_under_grant_hmac, which receipt verification checks.
export function revealedUnderGrantCount(ledger) {
  const entries = ledger?.receipt?.revealed_under_grant;
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((sum, entry) => {
    const values = Number(entry?.values);
    return sum + (Number.isFinite(values) && values > 0 ? values : 0);
  }, 0);
}

export function formatLocalReport(report, written = {}) {
  const lines = [formatSlipText(reportSlip(report))];
  const unchecked = uncheckedTerminalLines(
    Object.fromEntries(
      report.formats_passed_unmasked.map((entry) => [
        entry.format,
        entry.count,
      ]),
    ),
  );
  if (unchecked.length) lines.push('', ...unchecked);
  if (report.retention_note) lines.push('', report.retention_note);
  lines.push('');
  if (written.html) lines.push(`report.html: ${displayPath(written.html)}`);
  else if (report.latest_receipt_html)
    lines.push(`receipt.html: ${displayPath(report.latest_receipt_html)}`);
  else
    lines.push(
      `report.html: in a terminal, ${terminalCommand(['report', '--html', 'report.html'])}`,
    );
  if (written.json) lines.push(`report.json: ${written.json}`);
  return lines.join('\n');
}
