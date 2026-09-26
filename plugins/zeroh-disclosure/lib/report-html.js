// SPDX-License-Identifier: AGPL-3.0-only

// HTML rendering of receipts and reports: receipt.html for a session and
// report.html for a period. Self-contained pages (inline CSS, no scripts) that
// show the same slip as the terminal, then the details below it.
import {
  formatCounts,
  formatNotice,
  mergedCounts,
  observationFrom,
  rows,
  sumCounts,
} from './report-counts.js';
import {
  LOCAL_SUMMARY_NOTICE,
  REPORT_TITLE,
  reportSlip,
  sessionSlip,
  slipLines,
} from './report-slip.js';

export function renderReportHtml(report) {
  const max = Math.max(1, ...report.per_day.map((entry) => entry.masked));
  const bars = report.per_day
    .map((entry, index) => {
      const width = Math.min(48, 640 / Math.max(1, report.per_day.length));
      const height = Math.round((entry.masked / max) * 120);
      const x = Math.round(index * width);
      const y = 140 - height;
      return `<g><rect x="${x}" y="${y}" width="${Math.max(2, Math.floor(width - 3))}" height="${height}" rx="2"><title>${escapeHtml(entry.date)}: ${entry.masked} withheld</title></rect><text x="${x + 2}" y="157">${escapeHtml(entry.date.slice(5))}</text></g>`;
    })
    .join('');
  return htmlDocument(
    REPORT_TITLE,
    `${renderSlipHtml(reportSlip(report))}
<div class="below">
<p class="quiet">${escapeHtml(report.notice)} ${escapeHtml(report.period.label)} · ${escapeHtml(report.project.scope)} · generated ${escapeHtml(report.generated_at)}. ${escapeHtml(report.premium)}</p>
<div class="totals">${metric('Withheld', report.totals.values_masked)}${metric('Sent to Claude', report.totals.values_sent)}${metric('Prompts stopped', report.totals.prompts_stopped)}${metric('Receipts verified', `${report.totals.receipts_verified}/${report.totals.receipts_found}`)}</div>
<section><h2>Activity by day</h2><svg viewBox="0 0 640 170" role="img" aria-label="Values withheld per day">${bars || '<text x="8" y="30">No activity in this period</text>'}</svg></section>
<section class="grid"><div><h2>Withheld by type</h2>${htmlTable(report.masked_by_type, 'type')}</div><div><h2>Withheld by channel</h2>${htmlTable(report.masked_by_channel, 'channel')}</div><div><h2>Top files</h2>${htmlTable(report.top_files, 'path')}</div><div><h2>Blocked destinations</h2>${htmlTable(report.destinations_blocked, 'host')}</div></section>
<section id="unchecked"><h2>Passed unchecked</h2><p class="quiet">These formats are not scanned for values, so the slip does not count them as withheld or sent.</p>${htmlTable(report.formats_passed_unmasked, 'format', true)}</section>
</div>`,
  );
}

export function renderReceiptHtml({ summaries, tokenMap }) {
  const details = summaries
    .map(
      (
        summary,
        index,
      ) => `<details${index === summaries.length - 1 ? ' open' : ''}><summary>Turn ${summary.turn} · ${summary.values_masked} withheld · ${summary.values_sent} sent</summary>
<h3>What the model saw</h3>${tokenMapTable(summary.token_map)}
<div class="detail-grid"><div><h3>Withheld values</h3>${channelTables(summary.masked_by_channel)}</div>
<div><h3>Destinations</h3><p><strong>Checked:</strong> ${escapeHtml(formatCounts(summary.destinations_checked))}</p><p><strong>Blocked:</strong> ${escapeHtml(formatCounts(summary.destinations_blocked))}</p></div>
<div><h3>Passed unchecked</h3>${formatList(summary.formats_passed_unmasked)}</div>
<div><h3>Signed receipt</h3><dl><dt>Receipt</dt><dd>${escapeHtml(summary.receipt_id)}</dd><dt>Signed with</dt><dd>${escapeHtml(summary.signing ?? 'local key')}</dd><dt>Policy</dt><dd>${escapeHtml(summary.policy_id)}</dd><dt>Engine</dt><dd>${escapeHtml(summary.engine_id)}</dd><dt>Signature</dt><dd>${summary.signature_ok ? 'Verified' : 'Failed'}</dd><dt>Full verification</dt><dd>${summary.verified ? 'Verified' : 'Failed'}</dd></dl></div></div>
</details>`,
    )
    .join('\n');
  const unchecked = mergedCounts(
    summaries.map((item) => item.formats_passed_unmasked),
  );
  return htmlDocument(
    REPORT_TITLE,
    `${renderSlipHtml(sessionSlip(summaries))}
<div class="below">
<p class="quiet">${escapeHtml(LOCAL_SUMMARY_NOTICE)}</p>
<section><h2>What the model saw this session</h2>${sessionTokenMapTable(tokenMap)}</section>
${sumCounts(unchecked) > 0 ? `<section id="unchecked"><h2>Passed unchecked</h2><p class="quiet">These formats are not scanned for values, so the slip does not count them as withheld or sent.</p>${formatList(unchecked)}</section>` : ''}
<main>${details || '<p>No signed turns yet.</p>'}</main>
</div>`,
  );
}

export function renderSlipHtml(slip) {
  const parts = [];
  const footer = [];
  for (const line of slipLines(slip)) {
    if (line.kind === 'footer') {
      footer.push(`<p>${escapeHtml(line.text)}</p>`);
      continue;
    }
    if (line.kind === 'eyebrow')
      parts.push(`<p class="slip-eyebrow">${escapeHtml(line.text)}</p>`);
    else if (line.kind === 'title')
      parts.push(`<h1 class="slip-title">${escapeHtml(line.text)}</h1>`);
    else if (line.kind === 'meta')
      parts.push(`<p class="slip-meta">${escapeHtml(line.text)}</p>`);
    else if (line.kind === 'dash') parts.push('<hr class="slip-dash">');
    else if (line.kind === 'solid') parts.push('<hr class="slip-solid">');
    else if (line.kind === 'empty')
      parts.push(`<p class="slip-empty">${escapeHtml(line.text)}</p>`);
    else if (line.kind === 'note')
      parts.push(`<p class="slip-note">${escapeHtml(line.text)}</p>`);
    else if (line.kind === 'muted')
      parts.push(
        `<p class="slip-muted"><a href="#${line.anchor}">${escapeHtml(line.text)}</a></p>`,
      );
    else
      parts.push(
        `<div class="slip-row slip-${line.kind}"><span>${escapeHtml(line.label)}</span><strong>${escapeHtml(line.value)}</strong></div>`,
      );
  }
  const footerHtml = `<footer class="slip-footer">${footer.join('')}</footer>`;
  return `<div class="slip-wrap"><article class="slip" aria-label="Receipt">${parts.join('')}${footerHtml}</article></div>`;
}

const SLIP_CSS =
  '.slip-wrap{margin:var(--space-6) auto calc(var(--space-8) + .75rem);width:min(100%,26.25rem);filter:drop-shadow(0 .0625rem .0625rem rgba(20,24,40,.14)) drop-shadow(0 .75rem 1rem rgba(20,24,40,.22))}' +
  '.slip{--paper:#fbf8f1;--ink:#1f2433;--ink-muted:#6c7080;--accent:#cf3f78;--ok:#16806a;position:relative;padding:1.75rem 1.75rem 1.5rem;background:var(--paper);color:var(--ink);font-family:ui-monospace,"IBM Plex Mono",SFMono-Regular,Menlo,Consolas,monospace;font-size:.9375rem;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  '.slip::after{content:"";position:absolute;left:0;right:0;top:100%;height:.5rem;background:conic-gradient(from -45deg at 50% 100%,var(--paper) 90deg,transparent 0) 0 0/1rem .5rem repeat-x}' +
  '.slip p{margin:0}.slip-eyebrow{color:var(--accent);font-size:.75rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase}' +
  '.slip-title{font-family:inherit;font-size:1.3125rem;font-weight:700;margin:.15rem 0 0;letter-spacing:-.01em}.slip-meta{color:var(--ink-muted);font-size:.8125rem}' +
  '.slip hr{border:0;margin:.875rem 0}.slip-dash{border-top:.09375rem dashed #b7b3a8!important}.slip-solid{border-top:.125rem solid var(--ink)!important;margin:.625rem 0!important}' +
  '.slip-row{display:flex;justify-content:space-between;gap:1rem;align-items:baseline}.slip-row strong{font-weight:500;font-variant-numeric:tabular-nums}' +
  '.slip-total span,.slip-total strong{font-weight:700}.slip-sent-zero{color:var(--ok);margin-top:.5rem;align-items:flex-end}.slip-sent-zero span{font-weight:700}.slip-sent-zero strong{font-size:3.25rem;line-height:1;font-weight:800}' +
  '.slip-sent{margin-top:.5rem}.slip-sent strong{font-size:1.75rem;line-height:1;font-weight:700}' +
  '.slip-note,.slip-empty{font-size:.875rem}.slip-empty{color:var(--ink-muted)}.slip-muted{font-size:.8125rem;margin-top:.25rem!important}.slip-muted a{color:var(--ink-muted)}' +
  '.slip-footer{color:var(--ink-muted);font-size:.75rem;line-height:1.7;overflow-wrap:anywhere}';

function htmlDocument(title, body) {
  return `<!doctype html>
<html lang="en" data-theme="disclosure"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--background:oklch(0.9755 0.0029 264.54);--foreground:oklch(0.2263 0.0388 255.58);--card:oklch(1 0 0);--card-foreground:oklch(0.2263 0.0388 255.58);--muted-foreground:oklch(0.5671 0.0374 255.22);--border:oklch(0.9023 0.0138 255.03);--primary:oklch(0.7423 0.1361 178.54);--primary-text:oklch(0.4875 0.0902 177.32);--radius-md:0.5rem;--radius-lg:calc(var(--radius-md) + 0.25rem);--space-1:0.25rem;--space-2:0.5rem;--space-3:0.75rem;--space-4:1rem;--space-6:1.5rem;--space-8:2rem;--font-body:"IBM Plex Sans",system-ui,sans-serif;--font-display:"IBM Plex Mono",ui-monospace,monospace}*{box-sizing:border-box}body{margin:0 auto;max-width:65rem;padding:var(--space-8) var(--space-4);font-family:var(--font-body);font-size:0.9375rem;line-height:1.5;background:var(--background);color:var(--foreground)}.below{font-size:.875rem;color:var(--foreground)}.quiet{color:var(--muted-foreground);text-align:center;max-width:40rem;margin:var(--space-4) auto}h2,h3,summary{font-family:var(--font-display)}.below h2{font-size:1rem;color:var(--muted-foreground);font-weight:600;margin-top:0}h3{font-size:.9375rem}.totals,.grid,.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(11.25rem,1fr));gap:var(--space-3);margin:var(--space-4) 0}.below .metric,.below section,.below details{background:var(--card);color:var(--card-foreground);border:.0625rem solid var(--border);border-radius:var(--radius-lg);padding:var(--space-4);margin:var(--space-3) 0}.metric strong{display:block;font-family:var(--font-display);font-size:1.25rem}.metric span,dt{color:var(--muted-foreground)}summary{cursor:pointer;font-weight:600}table{width:100%;border-collapse:collapse}th{white-space:nowrap}th,td{text-align:left;border-bottom:.0625rem solid var(--border);padding:var(--space-2) var(--space-1);vertical-align:top;overflow-wrap:anywhere}th:last-child,td:last-child{text-align:right}dl{display:grid;grid-template-columns:max-content 1fr;gap:var(--space-2) var(--space-3)}dd{margin:0;overflow-wrap:anywhere}svg{width:100%;height:auto}svg rect{fill:var(--primary)}svg text{fill:var(--muted-foreground);font-family:var(--font-display);font-size:.625rem}${SLIP_CSS}@media(prefers-color-scheme:dark){:root{--background:oklch(0.1846 0.0273 255.48);--foreground:oklch(0.9319 0.0119 264.51);--card:oklch(0.2063 0.0299 255.46);--card-foreground:oklch(0.9319 0.0119 264.51);--muted-foreground:oklch(0.6854 0.0377 255.18);--border:oklch(0.3091 0.0362 255.36);--primary:oklch(0.7657 0.1362 179.97);--primary-text:oklch(0.7444 0.1384 176.7)}}@media print{body{max-width:none;padding:0;background:Canvas;color:CanvasText;font-size:11pt}.slip-wrap{break-inside:avoid;margin-top:0}.below .metric,.below section,.below details{background:Canvas;color:CanvasText;border-color:GrayText;break-inside:avoid}details{display:block}details>*{display:block}.totals,.grid,.detail-grid{gap:var(--space-2)}.below a{color:CanvasText;text-decoration:none}}
</style></head><body>${body}</body></html>\n`;
}

function htmlTable(entries, key, notices = false) {
  if (!entries.length) return '<p>-</p>';
  return `<table><thead><tr><th>${escapeHtml(key.replace(/_/g, ' '))}</th><th>Count</th></tr></thead><tbody>${entries
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry[key])}${notices && entry.notice ? `<br><small>${escapeHtml(entry.notice)}</small>` : ''}</td><td>${entry.count}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function tokenMapTable(entries) {
  if (!entries.length) return '<p>No sensitive values this turn.</p>';
  return `<table><thead><tr><th>The model saw</th><th>Type</th><th>From</th><th>Your value</th></tr></thead><tbody>${entries
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.token)}</td><td>${escapeHtml(entry.type)}</td><td>${escapeHtml(observationFrom(entry))}</td><td>${escapeHtml(entry.preview)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function sessionTokenMapTable(entries) {
  if (!entries.length) return '<p>No sensitive values this session.</p>';
  return `<table><thead><tr><th>The model saw</th><th>Type</th><th>From</th><th>Your value</th><th>First seen</th><th>Count</th></tr></thead><tbody>${entries
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.token)}</td><td>${escapeHtml(entry.type)}</td><td>${escapeHtml(entry.from)}</td><td>${escapeHtml(entry.preview)}</td><td>Turn ${entry.first_seen_turn}</td><td>${entry.count}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function channelTables(channels) {
  const entries = Object.entries(channels);
  if (!entries.length) return '<p>-</p>';
  return entries
    .map(
      ([channel, counts]) =>
        `<p><strong>${escapeHtml(channel)}:</strong> ${escapeHtml(formatCounts(counts))}</p>`,
    )
    .join('');
}

function formatList(counts) {
  const entries = rows(counts, 'format');
  if (!entries.length) return '<p>-</p>';
  return `<ul>${entries
    .map(
      (entry) =>
        `<li>${escapeHtml(entry.format)} × ${entry.count}. ${escapeHtml(formatNotice(entry.format))}</li>`,
    )
    .join('')}</ul>`;
}

function metric(label, value) {
  return `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
