// SPDX-License-Identifier: AGPL-3.0-only

// Receipts and reports, the data side: records what each turn masked and
// which destinations it checked (into the turn ledger's audit block), finds and
// verifies a session's receipts, and aggregates turns over a period for
// `zeroh-disclosure report`. The slip text lives in lib/report-slip.js and the
// HTML pages in lib/report-html.js.
import { mkdirSync, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  add,
  dayRows,
  formatNotice,
  mergeCounts,
  observationFrom,
  plural,
  rows,
  sumCounts,
} from './report-counts.js';
import { renderReceiptHtml, renderReportHtml } from './report-html.js';
import {
  LOCAL_SUMMARY_NOTICE,
  PREMIUM_NOTICE,
  SINCE_DAYS,
  previewValue,
  revealedUnderGrantCount,
  sessionSlip,
  signingLabel,
} from './report-slip.js';
import { displayPath, writePrivateJson } from './private-fs.js';
import { retentionNote } from './receipt-retention.js';
import {
  ensurePrivateDirSync,
  envSessionId,
  sanitizeSid,
  sessionDir,
  sessionsRoots,
  writeJson,
} from './session.js';
import {
  Vault,
  acquireFileLock,
  releaseFileLock,
  zerohHome as defaultZerohHome,
} from './vault.js';
import { verifyReceiptArtifact } from './verify-receipt.js';

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
} from './report-slip.js';
export { renderReportHtml } from './report-html.js';

export const DEFAULT_POLICY_ID = 'zeroh-disclosure-v1';

export const DEFAULT_ENGINE_ID = 'regex-local';

export async function registerProjectRoot({
  cwd = process.cwd(),
  env = process.env,
  now = new Date(),
} = {}) {
  try {
    const root = path.resolve(cwd);
    const file = path.join(zerohHome(env), 'projects.json');
    mkdirSync(path.dirname(file), { recursive: true });
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

export async function writeSessionReceiptHtml({ session, env = process.env }) {
  const turns = await loadSessionTurns(session.dir);
  const vault = new Vault(
    session.root ?? path.resolve(session.dir, '..', '..', '..'),
    {
      env,
    },
  );
  const summaries = [];
  for (const entry of turns) {
    summaries.push(await summarizeTurn(entry, vault));
  }
  const tokenMap = buildSessionTokenMap(summaries);
  const file = path.resolve(session.dir, 'receipt.html');
  ensurePrivateDirSync(session.dir);
  await fs.writeFile(file, renderReceiptHtml({ summaries, tokenMap }), {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.chmod(file, 0o600);
  return { path: file, summaries, tokenMap };
}

// What a turn has to report at Stop, or an empty list when it has nothing: no
// value masked, no prompt stopped, no destination blocked, no value shown under
// a grant, no file passed unchecked and no missed value reported.
export function stopTurnEvents(ledger, { blocked = null } = {}) {
  const events = [];
  const stopped = blocked ?? String(ledger?.phase).startsWith('blocked_');
  // A stopped prompt never reached the model, so its values count as stopped,
  // not masked.
  const masked = new Set([
    ...(stopped ? [] : uniqueReplacements(ledger?.replacements ?? []))
      .map((entry) => entry.token)
      .filter(Boolean),
    ...(ledger?.audit?.masked?.tokens ?? []),
    ...tokenObservationsFromLedger(ledger).map((entry) => entry.token),
  ]).size;
  if (masked > 0) events.push(`${masked} ${plural(masked, 'value')} masked`);
  if (stopped) events.push('prompt stopped');
  const destinations = sumCounts(ledger?.audit?.destinations?.blocked);
  if (destinations > 0) {
    events.push(
      `${destinations} ${plural(destinations, 'destination')} blocked`,
    );
  }
  const revealed = revealedUnderGrantCount(ledger);
  if (revealed > 0) {
    events.push(
      `${revealed} ${plural(revealed, 'value')} shown under your unmask grant`,
    );
  }
  const unchecked = sumCounts(ledger?.format_disclosure?.passed_unmasked);
  if (unchecked > 0) {
    events.push(`${unchecked} ${plural(unchecked, 'file')} passed unchecked`);
  }
  const misses = Number(ledger?.audit?.misses_reported) || 0;
  if (misses > 0) {
    events.push(`${misses} missed ${plural(misses, 'value')} reported`);
  }
  return events;
}

// One Stop line for a turn with something to report; null for a quiet turn.
export function formatStopReceiptLine(
  turn,
  ledger,
  receiptPath = null,
  { blocked = null } = {},
) {
  const events = stopTurnEvents(ledger, { blocked });
  if (!events.length) return null;
  const claims = ledger?.receipt?.public_claims ?? {};
  const parts = [
    'ZeroH Disclosure',
    `turn ${turn}`,
    events.join(', '),
    `receipt: ${receiptPath ? displayPath(receiptPath) : `turn-${turn}.json`}`,
  ];
  if (claims.policy_id && claims.policy_id !== DEFAULT_POLICY_ID) {
    parts.push(`policy ${claims.policy_id}`);
  }
  if (
    claims.protection_engine_id &&
    claims.protection_engine_id !== DEFAULT_ENGINE_ID
  ) {
    parts.push(`engine ${claims.protection_engine_id}`);
  }
  return parts.join(' · ');
}

// What the model saw in a turn (T-20), for a second Stop line: each token in
// its ⟦⟧ form, which nothing restores, with where it came from (a variable
// name, a file name, "typed", or the tool). Never a value or a preview. At
// most three, then how many more and where to see them all. Null when the
// turn masked nothing the model saw.
const STOP_TOKEN_LIMIT = 3;

function seenFrom(entry) {
  if (entry.name) return entry.name;
  if (entry.channel === 'typed prompt') return 'typed';
  if (entry.channel === 'file read') {
    const parts = entry.source.split(' · ');
    const last = parts.at(-1);
    if (parts.length > 1 && !/^line \d+$/u.test(last)) return last;
    return path.basename(parts[0]);
  }
  if (entry.channel === 'command output') return 'command output';
  return entry.source;
}

export function formatStopTokenLine(ledger, { blocked = null } = {}) {
  if (blocked ?? String(ledger?.phase).startsWith('blocked_')) return null;
  const seen = new Map();
  for (const entry of tokenObservationsFromLedger(ledger)) {
    if (!seen.has(entry.token)) seen.set(entry.token, seenFrom(entry));
  }
  for (const replacement of ledger?.replacements ?? []) {
    const token = replacement?.replacement;
    if (token && !seen.has(token)) seen.set(token, 'typed');
  }
  if (!seen.size) return null;
  const listed = [...seen]
    .slice(0, STOP_TOKEN_LIMIT)
    .map(([token, from]) => `⟦${token.slice(1, -1)}⟧ for ${from}`);
  const more = seen.size - listed.length;
  return `Claude saw ${listed.join(' · ')}${
    more > 0 ? ` · +${more} more · /zeroh-disclosure:mask-show` : ''
  }`;
}

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
  const roots = [...new Set(projectRoots.map((root) => path.resolve(root)))];
  for (const root of roots) {
    await aggregateProject({ root, period, aggregate });
  }
  aggregate.totals.sessions = aggregate.sessionIds.size;
  aggregate.totals.files_passed_unchecked = sumCounts(aggregate.formats);
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
    await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    written.json = file;
  }
  if (htmlPath) {
    const file = path.resolve(htmlPath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, renderReportHtml(report), {
      encoding: 'utf8',
      mode: 0o600,
    });
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
  const promptReplacements = uniqueReplacements(ledger.replacements ?? []);
  for (const replacement of promptReplacements) {
    add(aggregate.maskedByType, replacement.type, replacement.count);
    add(aggregate.maskedByChannel, 'typed prompt', replacement.count);
  }
  const auditMasked = ledger.audit?.masked ?? {};
  for (const [type, count] of Object.entries(auditMasked.by_type ?? {})) {
    add(aggregate.maskedByType, type, count);
  }
  for (const [channel, types] of Object.entries(auditMasked.by_channel ?? {})) {
    add(aggregate.maskedByChannel, channel, sumCounts(types));
  }
  // "withheld" counts every occurrence replaced by a token before it reached
  // the model, summed across prompt and tool-output types shown on the slip.
  const masked =
    promptReplacements.reduce(
      (sum, replacement) => sum + replacement.count,
      0,
    ) + sumCounts(auditMasked.by_type);
  // Only detected values explicitly recorded as revealed under a user-approved
  // grant count as sent. A receipt without reveal data counts zero; unchecked binary files do not.
  const sent = revealedUnderGrantCount(ledger);
  aggregate.totals.values_masked += masked;
  aggregate.totals.values_sent += sent;
  dayEntry.masked += masked;
  dayEntry.sent += sent;
  if (String(ledger.phase).startsWith('blocked_')) {
    aggregate.totals.prompts_stopped += 1;
    dayEntry.prompts_stopped += 1;
  }
  mergeCounts(aggregate.files, ledger.audit?.files);
  mergeCounts(
    aggregate.destinationsBlocked,
    ledger.audit?.destinations?.blocked,
  );
  mergeCounts(aggregate.formats, ledger.format_disclosure?.passed_unmasked);
}

async function summarizeTurn({ turn, ledger, file }, vault = null) {
  const verification = await verifyReceiptArtifact(file).catch(() => ({
    ok: false,
    checks: [],
  }));
  const prompt = uniqueReplacements(ledger.replacements ?? []);
  const maskedByChannel = {};
  if (prompt.length)
    maskedByChannel['typed prompt'] = countReplacementTypes(prompt);
  for (const [channel, counts] of Object.entries(
    ledger.audit?.masked?.by_channel ?? {},
  )) {
    maskedByChannel[channel] = { ...counts };
  }
  const byType = {};
  for (const counts of Object.values(maskedByChannel))
    mergeCounts(byType, counts);
  const tokens = [
    ...new Set([
      ...prompt.map((entry) => entry.token).filter(Boolean),
      ...(ledger.audit?.masked?.tokens ?? []),
    ]),
  ].sort();
  const claims = ledger.receipt?.public_claims ?? {};
  const valuesMasked = sumCounts(byType);
  const valuesSent = revealedUnderGrantCount(ledger);
  const tokenMap = tokenObservationsFromLedger(ledger).map((entry) => ({
    ...entry,
    preview: previewForToken(vault, entry.token, entry.type),
  }));
  return {
    turn,
    date: recordDate(ledger)?.toISOString().slice(0, 10) ?? '-',
    ledger_path: path.resolve(file),
    receipt_id: ledger.receipt?.receipt_id ?? '-',
    signing: signingLabel(ledger),
    policy_id: claims.policy_id ?? '-',
    engine_id: claims.protection_engine_id ?? '-',
    values_masked: valuesMasked,
    values_sent: valuesSent,
    masked_by_type: byType,
    masked_by_channel: maskedByChannel,
    masked_by_channel_totals: Object.fromEntries(
      Object.entries(maskedByChannel).map(([channel, counts]) => [
        channel,
        sumCounts(counts),
      ]),
    ),
    tokens,
    token_map: tokenMap,
    destinations_checked: { ...(ledger.audit?.destinations?.checked ?? {}) },
    destinations_blocked: { ...(ledger.audit?.destinations?.blocked ?? {}) },
    formats_passed_unmasked: {
      ...(ledger.format_disclosure?.passed_unmasked ?? {}),
    },
    formats_withheld: { ...(ledger.format_disclosure?.withheld ?? {}) },
    verified: !!verification.ok,
    failed_checks:
      verification.failed ?? (verification.ok ? [] : ['receipt_readable']),
    signature_ok: !!verification.checks?.find(
      (entry) => entry.name === 'signature',
    )?.ok,
  };
}

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
  const lock = acquireFileLock(`${file}.lock`);
  try {
    const ledger = await readJson(file);
    if (!ledger) return;
    const audit = (ledger.audit ??= {});
    mutate(audit);
    await writeJson(file, ledger);
  } finally {
    releaseFileLock(lock);
  }
}

function emptyAggregate() {
  return {
    totals: {
      values_masked: 0,
      values_sent: 0,
      prompts_stopped: 0,
      receipts_found: 0,
      receipts_verified: 0,
      sessions: 0,
      turns: 0,
      files_passed_unchecked: 0,
    },
    maskedByType: {},
    maskedByChannel: {},
    perDay: {},
    files: {},
    destinationsBlocked: {},
    formats: {},
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

function uniqueReplacements(replacements) {
  const found = new Map();
  for (const replacement of replacements ?? []) {
    const type = replacement?.entity_type || replacement?.type;
    const token = replacement?.replacement || replacement?.token;
    if (!type) continue;
    const key = token || `${type}:${replacement?.start}:${replacement?.end}`;
    const current = found.get(key) ?? {
      type,
      token: token || null,
      count: 0,
    };
    current.count += Math.max(1, Number(replacement?.count) || 1);
    found.set(key, current);
  }
  return [...found.values()];
}

function normalizeTokenObservations(observations) {
  const found = new Map();
  for (const observation of observations ?? []) {
    const token = observation?.token || observation?.replacement;
    const type = observation?.type || observation?.entity_type;
    const channel = String(observation?.channel || '').trim();
    const source = String(observation?.source || '').trim();
    if (!token || !type || !channel || !source) continue;
    const key = `${token}\u0000${type}\u0000${channel}\u0000${source}`;
    const current = found.get(key) ?? {
      token,
      type,
      channel,
      source,
      count: 0,
    };
    // The known value's own name (STRIPE_KEY), never the value.
    if (!current.name && typeof observation?.name === 'string') {
      current.name = observation.name;
    }
    current.count += Math.max(1, Number(observation?.count) || 1);
    found.set(key, current);
  }
  return [...found.values()].sort(
    (left, right) =>
      left.token.localeCompare(right.token) ||
      left.channel.localeCompare(right.channel) ||
      left.source.localeCompare(right.source),
  );
}

function mergeTokenObservations(target, incoming) {
  const merged = normalizeTokenObservations([...(target ?? []), ...incoming]);
  target.splice(0, target.length, ...merged);
}

function tokenObservationsFromLedger(ledger) {
  return normalizeTokenObservations(ledger?.audit?.masked?.token_map ?? []);
}

function previewForToken(vault, token, type) {
  if (!vault) return '•••';
  const value = vault.valueOf(token);
  return value == null ? '•••' : previewValue(type, value);
}

function buildSessionTokenMap(summaries) {
  const byToken = new Map();
  for (const summary of summaries) {
    for (const entry of summary.token_map ?? []) {
      const current = byToken.get(entry.token) ?? {
        token: entry.token,
        type: entry.type,
        sources: new Set(),
        preview: entry.preview,
        first_seen_turn: summary.turn,
        count: 0,
      };
      current.sources.add(observationFrom(entry));
      current.first_seen_turn = Math.min(current.first_seen_turn, summary.turn);
      current.count += entry.count;
      byToken.set(entry.token, current);
    }
  }
  return [...byToken.values()]
    .map(({ sources, ...entry }) => ({
      ...entry,
      from: [...sources].sort().join('; '),
    }))
    .sort(
      (left, right) =>
        left.first_seen_turn - right.first_seen_turn ||
        left.token.localeCompare(right.token),
    );
}

function countReplacementTypes(replacements) {
  const counts = {};
  for (const replacement of replacements)
    add(counts, replacement.type, replacement.count);
  return counts;
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
