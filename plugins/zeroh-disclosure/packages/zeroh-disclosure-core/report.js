// SPDX-License-Identifier: AGPL-3.0-only

// Stable report entrypoint. Implementations are split by concern.
export {
  buildLocalReport,
  buildReportForOptions,
  findSessionDir,
  receiptSummary,
  recordDestinationCheck,
  recordMaskedOutput,
  recordMissReported,
  registeredProjectRoots,
  registerProjectRoot,
  sessionTokenMap,
  writeLocalReport,
  writeSessionReceiptHtml,
} from './report/collect.js';
export {
  DEFAULT_ENGINE_ID,
  DEFAULT_POLICY_ID,
  formatStopReceiptLine,
  formatStopTokenLine,
  shownTurnSummary,
  stopPreview,
  stopTurnEvents,
  turnMaskedCount,
  uncheckedRows,
} from './report/render.js';
export {
  LOCAL_SUMMARY_NOTICE,
  PREMIUM_NOTICE,
  RECEIPT_WIDTH,
  REPORT_TITLE,
  dateRangeLabel,
  formatLocalReport,
  formatReceiptSummary,
  formatSessionTokenMap,
  formatSlipText,
  previewValue,
  reportSlip,
  sessionSlip,
  slipLines,
} from './report-slip.js';
export { renderReportHtml } from './report-html.js';
export { promptSentUnmasked, promptStopped } from './turn-summary.js';
