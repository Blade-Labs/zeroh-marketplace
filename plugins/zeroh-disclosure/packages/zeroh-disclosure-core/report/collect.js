// SPDX-License-Identifier: AGPL-3.0-only

import { writeReceiptBytes, writeReceiptJson } from '../receipt-sink.js';
// Receipts and reports, the data side: records what each turn masked and
// which destinations it checked (into the turn ledger's audit block), finds and
// verifies a session's receipts, and aggregates turns over a period for
// `zeroh-disclosure report`. The slip text lives in packages/zeroh-disclosure-core/report-slip.js and the
// HTML pages in packages/zeroh-disclosure-core/report-html.js.
import { mkdirSync, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildSessionTokenMap,
  maskStoredLabel,
  shownTurnSummary,
  summarizeTurn,
  uncheckedRows,
} from './render.js';
import {
  add,
  dayRows,
  formatNotice,
  mergeCounts,
  rows,
  sumCounts,
} from '../report-counts.js';
import { renderReceiptHtml, renderReportHtml } from '../report-html.js';
import {
  LOCAL_SUMMARY_NOTICE,
  PREMIUM_NOTICE,
  SINCE_DAYS,
  previewValue,
  revealedUnderGrantCount,
  sessionSlip,
  signingLabel,
} from '../report-slip.js';
import {
  canonicalProjectPath,
  displayPath,
  writePrivateJson,
  sessionCanPersist,
} from '../private-fs.js';
import { retentionNote } from '../receipt-retention.js';
import {
  ensurePrivateDirSync,
  envSessionId,
  sanitizeSid,
  sessionDir,
  sessionsRoots,
} from '../session.js';
import {
  Vault,
  acquireFileLock,
  releaseFileLock,
  zerohHome as defaultZerohHome,
} from '../vault.js';
import {
  normalizeTokenObservations,
  uniqueReplacements,
} from '../turn-summary.js';
import { verifyReceiptArtifact } from '../verify-receipt.js';
import {
  TOKEN_REASONS,
  UNCHECKED_LABELS,
  uncheckedCounts,
} from '../unchecked.js';

// The terminal slip and the HTML pages live in their own modules; callers keep
// importing them from here.
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
} from '../report-slip.js';
export { renderReportHtml } from '../report-html.js';
export { promptSentUnmasked, promptStopped } from '../turn-summary.js';

export async function registerProjectRoot({
  cwd = process.cwd(),
  env = process.env,
  now = new Date(),
} = {}) {
  try {
    const root = path.resolve(cwd);
    const file = path.join(zerohHome(env), 'projects.json');
    mkdirSync(path.dirname(file), { recursive: true });
    if (!sessionCanPersist(file)) return;
    const lock = acquireFileLock(`${file}.lock`);
    try {
      const current = readJsonSync(file) ?? {
        schema: 'zeroh-project-registry/v1',
        projects: [],
      };
      const projects = Array.isArray(current.projects) ? current.projects : [];
      const existing = projects.find((entry) => entry?.root === root);
      if (existing) existing.last_seen_at = now.toISOString();
      else projects.push({ root, last_seen_at: now.toISOString() });
      current.schema = 'zeroh-project-registry/v1';
      current.projects = projects
        .filter((entry) => typeof entry?.root === 'string')
        .sort((left, right) => left.root.localeCompare(right.root));
      writePrivateJson(file, current);
    } finally {
      releaseFileLock(lock);
    }
    return file;
  } catch {
    // Project discovery must never prevent a Claude Code session from starting.
    return null;
  }
}

export async function registeredProjectRoots({ env = process.env } = {}) {
  const registry = await readJson(path.join(zerohHome(env), 'projects.json'));
  return [
    ...new Set(
      (registry?.projects ?? [])
        .map((entry) => entry?.root)
        .filter((root) => typeof root === 'string')
        .map((root) => path.resolve(root)),
    ),
  ];
}

export async function recordMaskedOutput({
  cwd,
  sessionId,
  channel,
  replacements = [],
  filePath = null,
  observations = [],
  countMasked = true,
}) {
  try {
    const unique = uniqueReplacements(replacements);
    const tokenMap = normalizeTokenObservations(observations);
    if (unique.length === 0 && tokenMap.length === 0) return;
    await updateCurrentTurnAudit({ cwd, sessionId }, (audit) => {
      audit.masked ??= {
        by_type: {},
        by_channel: {},
        tokens: [],
        token_map: [],
      };
      audit.masked.by_type ??= {};
      audit.masked.by_channel ??= {};
      audit.masked.tokens ??= [];
      audit.masked.token_map ??= [];
      if (countMasked) {
        const channelCounts = (audit.masked.by_channel[channel] ??= {});
        for (const replacement of unique) {
          add(audit.masked.by_type, replacement.type, replacement.count);
          add(channelCounts, replacement.type, replacement.count);
          if (
            replacement.token &&
            !audit.masked.tokens.includes(replacement.token)
          ) {
            audit.masked.tokens.push(replacement.token);
          }
        }
        audit.masked.tokens.sort();
      }
      mergeTokenObservations(audit.masked.token_map, tokenMap);
      if (filePath && countMasked) {
        audit.files ??= {};
        add(
          audit.files,
          path.resolve(cwd || process.cwd(), filePath),
          unique.reduce((sum, replacement) => sum + replacement.count, 0),
        );
      }
    });
  } catch {
    // Audit enrichment must never expose or replace an otherwise safe tool result.
  }
}

export async function recordDestinationCheck({
  session,
  hosts = [],
  blockedHosts = [],
}) {
  try {
    if (!session || hosts.length === 0) return;
    const blocked = new Set(blockedHosts.map(normalizeHost));
    await updateTurnAudit(session, (audit) => {
      audit.destinations ??= { checked: {}, blocked: {} };
      audit.destinations.checked ??= {};
      audit.destinations.blocked ??= {};
      for (const rawHost of new Set(hosts)) {
        const host = normalizeHost(rawHost);
        if (!host) continue;
        add(audit.destinations.checked, host, 1);
        if (blocked.has(host)) add(audit.destinations.blocked, host, 1);
      }
    });
  } catch {
    // Destination enforcement has already happened; reporting stays fail-soft.
  }
}

// `previews: false` (the receipts uninstall keeps, packages/zeroh-disclosure-core/receipt-keep.js):
// no vault is opened and no value preview is shown.
export async function writeSessionReceiptHtml({
  session,
  env = process.env,
  previews = true,
  turns = null,
  verifications = null,
}) {
  turns ??= await loadSessionTurns(session.dir);
  const vault =
    previews && sessionCanPersist(path.join(session.dir, 'receipt.html'))
      ? new Vault(session.root ?? path.resolve(session.dir, '..', '..', '..'), {
          env,
        })
      : null;
  // Crypto verification uses asynchronous work. Verify independent turns
  // together rather than adding one full verification latency per turn.
  const summaries = await Promise.all(
    turns
      .filter((entry) => entry.ledger)
      .map((entry) =>
        summarizeTurn(entry, vault, verifications?.get(entry.turn)),
      ),
  );
  const tokenMap = buildSessionTokenMap(summaries);
  const file = path.resolve(session.dir, 'receipt.html');
  if (!sessionCanPersist(file)) return { path: null, summaries, tokenMap };
  ensurePrivateDirSync(session.dir);
  writeReceiptBytes(
    file,
    renderReceiptHtml({ summaries, tokenMap }),
    'receipt-html',
  );
  return { path: file, summaries, tokenMap };
}

// The values a turn masked: distinct tokens of its prompt (unless the prompt
// was stopped or sent unmasked) and of the tool output it masked.

// The MCP report_missed_secret tool has no session id; PostToolUse records a
// successful report on the current turn so Stop can mention it.
export async function recordMissReported({ cwd, sessionId }) {
  try {
    await updateCurrentTurnAudit({ cwd, sessionId }, (audit) => {
      audit.misses_reported = (Number(audit.misses_reported) || 0) + 1;
    });
  } catch {
    // Reporting stays fail-soft; the miss is already masked in the vault.
  }
}

export async function sessionTokenMap({
  projectRoot = process.cwd(),
  sessionId = null,
  env = process.env,
} = {}) {
  const dir = await findSessionDir({ projectRoot, sessionId, env });
  const turns = await loadSessionTurns(dir);
  const vault = new Vault(projectRoot, { env });
  const summaries = [];
  for (const entry of turns) summaries.push(await summarizeTurn(entry, vault));
  return { dir, rows: buildSessionTokenMap(summaries) };
}

export async function findSessionDir({
  projectRoot = process.cwd(),
  sessionId = null,
  env = process.env,
} = {}) {
  const roots = sessionsRoots(projectRoot, env);
  const requested = sessionId || envSessionId(env);
  if (requested) {
    for (const sessionsRoot of roots) {
      const dir = path.join(sessionsRoot, sanitizeSid(requested));
      const stat = await fs.stat(dir).catch(() => null);
      if (stat?.isDirectory()) return dir;
    }
    throw new Error(`session not found: ${requested}`);
  }
  const candidates = [];
  for (const sessionsRoot of roots) {
    const entries = await fs
      .readdir(sessionsRoot, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(sessionsRoot, entry.name);
      const stat = await fs.stat(dir).catch(() => null);
      if (stat) candidates.push({ dir, mtimeMs: stat.mtimeMs });
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (!candidates[0]) throw new Error('no ZeroH Disclosure sessions found');
  return candidates[0].dir;
}

export async function receiptSummary({
  projectRoot = process.cwd(),
  sessionId = null,
  turn = null,
  env = process.env,
} = {}) {
  const dir = await findSessionDir({ projectRoot, sessionId, env });
  const turns = await loadSessionTurns(dir);
  const selected =
    turn == null ? turns : turns.filter((entry) => entry.turn === Number(turn));
  if (!selected.length) {
    throw new Error(
      turn == null ? 'no finalized receipt found' : `turn ${turn} not found`,
    );
  }
  const summaries = [];
  for (const entry of selected) summaries.push(await summarizeTurn(entry));
  const receiptHtml = path.join(dir, 'receipt.html');
  const htmlExists = await isFile(receiptHtml);
  return {
    dir,
    turn: turn == null ? null : Number(turn),
    receipt_html: htmlExists ? receiptHtml : null,
    summaries,
    slip: sessionSlip(summaries, { turn: turn == null ? null : Number(turn) }),
  };
}

export async function buildLocalReport({
  projectRoots = [process.cwd()],
  since = '7d',
  now = new Date(),
  scope = 'project',
} = {}) {
  const period = parseSince(since, now);
  const aggregate = emptyAggregate();
  const roots = [
    ...new Set(projectRoots.map((root) => canonicalProjectPath(root))),
  ];
  for (const root of roots) {
    await aggregateProject({ root, period, aggregate });
  }
  aggregate.totals.sessions = aggregate.sessionIds.size;
  aggregate.totals.files_passed_unchecked = sumCounts(aggregate.formats);
  aggregate.totals.passed_unchecked = sumCounts(aggregate.unchecked);
  const report = {
    schema: 'zeroh-disclosure-local-report/v1',
    kind: 'local_summary',
    generated_at: now.toISOString(),
    period: {
      label: since,
      start: period.start ? period.start.toISOString() : null,
      end: now.toISOString(),
    },
    // D-16: when the period reaches past ZEROH_RECEIPT_RETENTION.
    retention_note: retentionNote(
      period.start ? now.getTime() - period.start.getTime() : null,
    ),
    project: {
      scope,
      roots,
    },
    notice: LOCAL_SUMMARY_NOTICE,
    premium: PREMIUM_NOTICE,
    totals: aggregate.totals,
    latest_receipt_id: aggregate.latestReceipt?.id ?? '-',
    latest_receipt_signing: aggregate.latestReceipt?.signing ?? null,
    latest_receipt_html: (await isFile(aggregate.latestReceipt?.html))
      ? aggregate.latestReceipt.html
      : null,
    masked_by_type: rows(aggregate.maskedByType, 'type'),
    masked_by_channel: rows(aggregate.maskedByChannel, 'channel'),
    per_day: dayRows(aggregate.perDay),
    top_files: rows(aggregate.files, 'path').slice(0, 5),
    destinations_blocked: rows(aggregate.destinationsBlocked, 'host'),
    formats_passed_unmasked: rows(aggregate.formats, 'format').map((entry) => ({
      ...entry,
      notice: formatNotice(entry.format),
    })),
    passed_unchecked: uncheckedRows(aggregate.unchecked),
  };
  return report;
}

export async function buildReportForOptions({
  cwd = process.cwd(),
  since = '7d',
  project = '.',
  allProjects = false,
  env = process.env,
  now = new Date(),
} = {}) {
  const current = path.resolve(cwd, project || '.');
  const roots = allProjects
    ? [...new Set([current, ...(await registeredProjectRoots({ env }))])]
    : [current];
  return buildLocalReport({
    projectRoots: roots,
    since,
    now,
    scope: allProjects ? 'all-projects' : 'project',
  });
}

export async function writeLocalReport({
  report,
  htmlPath = null,
  jsonPath = null,
}) {
  const written = {};
  if (jsonPath) {
    const file = path.resolve(jsonPath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    writeReceiptBytes(
      file,
      `${JSON.stringify(report, null, 2)}\n`,
      'report-export',
    );
    written.json = file;
  }
  if (htmlPath) {
    const file = path.resolve(htmlPath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    writeReceiptBytes(file, renderReportHtml(report), 'report-export');
    written.html = file;
  }
  return written;
}

async function aggregateProject({ root, period, aggregate }) {
  const sessions = [];
  for (const sessionsRoot of sessionsRoots(root)) {
    for (const entry of await fs
      .readdir(sessionsRoot, { withFileTypes: true })
      .catch(() => [])) {
      if (entry.isDirectory()) {
        sessions.push(path.join(sessionsRoot, entry.name));
      }
    }
  }
  for (const dir of sessions) {
    const entries = await fs.readdir(dir).catch(() => []);
    for (const name of entries) {
      if (!/^turn-\d+\.json$/.test(name)) continue;
      const file = path.join(dir, name);
      const record = await readJson(file);
      if (!record?.receipt) continue;
      const date = recordDate(record);
      if (!date || (period.start && date < period.start) || date > period.end)
        continue;
      aggregate.totals.receipts_found += 1;
      if (!aggregate.latestReceipt || date > aggregate.latestReceipt.date) {
        aggregate.latestReceipt = {
          date,
          id: record.receipt?.receipt_id ?? '-',
          signing: signingLabel(record),
          html: path.join(dir, 'receipt.html'),
        };
      }
      const verification = await verifyReceiptArtifact(file).catch(() => ({
        ok: false,
      }));
      if (verification.ok) aggregate.totals.receipts_verified += 1;
      const day = date.toISOString().slice(0, 10);
      const dayEntry = (aggregate.perDay[day] ??= {
        masked: 0,
        sent: 0,
        prompts_stopped: 0,
        receipts: 0,
      });
      dayEntry.receipts += 1;
      aggregate.sessionIds.add(`${root}\u0000${path.basename(dir)}`);
      aggregate.totals.turns += 1;
      addTurnToAggregate(record, aggregate, dayEntry);
    }
  }
}

function addTurnToAggregate(ledger, aggregate, dayEntry) {
  // The same numbers the turn's receipt shows (signed from 1.0.0 on).
  const { summary } = shownTurnSummary(ledger);
  mergeCounts(aggregate.maskedByType, summary.masked_by_type);
  for (const [channel, types] of Object.entries(summary.masked_by_channel)) {
    add(aggregate.maskedByChannel, channel, sumCounts(types));
  }
  // "withheld" counts every occurrence replaced by a token before it reached
  // the model, summed across prompt and tool-output types shown on the slip.
  const masked = summary.values_masked;
  const sent = summary.values_sent;
  aggregate.totals.values_masked += masked;
  aggregate.totals.values_sent += sent;
  aggregate.totals.values_sent_typed += summary.sent_unmasked?.count ?? 0;
  dayEntry.masked += masked;
  dayEntry.sent += sent;
  if (summary.prompt === 'stopped') {
    aggregate.totals.prompts_stopped += 1;
    dayEntry.prompts_stopped += 1;
  }
  mergeCounts(
    aggregate.files,
    Object.fromEntries(
      Object.entries(summary.files).map(([file, count]) => [
        maskStoredLabel(file),
        count,
      ]),
    ),
  );
  mergeCounts(aggregate.destinationsBlocked, summary.destinations_blocked);
  mergeCounts(aggregate.formats, summary.formats_passed_unmasked);
  mergeCounts(aggregate.unchecked, summary.passed_unchecked);
}

// Passed-unchecked counts as rows: reason, count and a value-free label.

async function loadSessionTurns(dir) {
  const names = (await fs.readdir(dir).catch(() => []))
    .filter((name) => /^turn-\d+\.json$/.test(name))
    .sort((left, right) => turnNumber(left) - turnNumber(right));
  const turns = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const ledger = await readJson(file);
    if (ledger?.receipt) turns.push({ turn: turnNumber(name), ledger, file });
  }
  return turns;
}

async function updateCurrentTurnAudit({ cwd, sessionId }, mutate) {
  const dir = sessionDir(cwd, sessionId);
  const state = await readJson(path.join(dir, 'state.json'));
  if (!state || Number(state.turnCount) < 1) return;
  await updateTurnAudit({ dir, state }, mutate);
}

async function updateTurnAudit(session, mutate) {
  const turn = Number(session?.state?.turnCount ?? 0);
  if (turn < 1) return;
  const file = path.join(session.dir, `turn-${turn}.json`);
  if (!sessionCanPersist(file)) return;
  const lock = acquireFileLock(`${file}.lock`);
  try {
    const ledger = await readJson(file);
    if (!ledger) return;
    const audit = (ledger.audit ??= {});
    mutate(audit);
    await writeReceiptJson(file, ledger);
  } finally {
    releaseFileLock(lock);
  }
}

function emptyAggregate() {
  return {
    totals: {
      values_masked: 0,
      values_sent: 0,
      values_sent_typed: 0,
      prompts_stopped: 0,
      receipts_found: 0,
      receipts_verified: 0,
      sessions: 0,
      turns: 0,
      files_passed_unchecked: 0,
      passed_unchecked: 0,
    },
    maskedByType: {},
    maskedByChannel: {},
    perDay: {},
    files: {},
    destinationsBlocked: {},
    formats: {},
    unchecked: {},
    sessionIds: new Set(),
    latestReceipt: null,
  };
}

function parseSince(value, now) {
  const key = String(value || '7d').toLowerCase();
  if (key === 'all') return { start: null, end: now };
  const days = SINCE_DAYS[key];
  if (!days) throw new Error('--since must be 7d, 30d, 90d, or all');
  return { start: new Date(now.getTime() - days * 86_400_000), end: now };
}

function recordDate(record) {
  const value =
    record.finalized_at ||
    record.created_at ||
    record.receipt?.public_claims?.iat;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mergeTokenObservations(target, incoming) {
  const merged = normalizeTokenObservations([...(target ?? []), ...incoming]);
  target.splice(0, target.length, ...merged);
}

function normalizeHost(host) {
  return String(host ?? '')
    .trim()
    .toLowerCase();
}

function turnNumber(name) {
  return Number(name.match(/^turn-(\d+)\.json$/)?.[1]);
}

function zerohHome(env) {
  return path.resolve(defaultZerohHome(env));
}

async function isFile(file) {
  if (!file) return false;
  return fs
    .stat(file)
    .then((stat) => stat.isFile())
    .catch(() => false);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function readJsonSync(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
