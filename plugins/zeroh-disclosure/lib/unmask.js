// SPDX-License-Identifier: AGPL-3.0-only

// Timed unmask grants: the user lets real values of one personal-data kind be
// shown to the model for a while. Keys and passwords are never unmasked.
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import {
  allowKeyPath,
  loadOrCreateAllowKey,
  signatureFor,
  signaturesMatch,
} from './allow-rules.js';
import { isSecretType, normaliseKind, SECRET_TYPES } from './data-kinds.js';
import { detectorManifest } from './detector.js';
import { writePrivateJson } from './private-fs.js';
import { envSessionId, sessionDir } from './session.js';
import {
  acquireFileLock,
  projectKey,
  releaseFileLock,
  zerohHome,
} from './vault.js';

const VERSION = 1;
export const REVEAL_EXTENSION_MARKER = 'hmac-v1';
export { isSecretType, normaliseKind, SECRET_TYPES }; // Every personal-data kind the plugin can mask (names are Premium).
export const PERSONAL_DATA_TYPES = Object.freeze(
  [...new Set(detectorManifest().categories.map(({ type }) => type))]
    .filter((type) => !SECRET_TYPES.includes(type))
    .sort(),
);
export const CAP_VALUES = Object.freeze(['0', '15m', '1h', 'session']);
export const DURATION_OPTIONS = Object.freeze([
  { value: '15m', label: '15 minutes', milliseconds: 15 * 60 * 1000 },
  { value: '1h', label: '1 hour', milliseconds: 60 * 60 * 1000 },
  {
    value: 'session',
    label: 'Until the session ends',
    milliseconds: null,
  },
]);

export function isPersonalDataType(kind) {
  return PERSONAL_DATA_TYPES.includes(normaliseKind(kind));
}

// By default every duration is offered (T-32); the user lowers a cap from a
// terminal.
export function defaultCaps() {
  return Object.fromEntries(
    PERSONAL_DATA_TYPES.map((kind) => [kind, 'session']),
  );
}

export function capsFilePath(home = zerohHome()) {
  return path.join(path.resolve(home), 'unmask.json');
}

export function grantsFilePath(root = process.cwd(), home = zerohHome()) {
  return path.join(
    path.resolve(home),
    'grants',
    `${projectKey(path.resolve(root))}.json`,
  );
}

function mcpSessionClaimPath(root = process.cwd(), home = zerohHome()) {
  return path.join(
    path.resolve(home),
    'run',
    'unmask-mcp',
    `${projectKey(path.resolve(root))}.json`,
  );
}

export function claimUnmaskMcpSession(
  root,
  sessionId,
  { home = zerohHome(), now = Date.now(), maxAgeMs = 60_000 } = {},
) {
  if (!sessionId) return false;
  const file = mcpSessionClaimPath(root, home);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = acquireFileLock(`${file}.lock`);
  try {
    const existing = readSessionValue(file, root, { now, maxAgeMs });
    if (existing) return false;
    writeSessionValue(file, root, sessionId, now);
    return true;
  } finally {
    releaseFileLock(lock);
  }
}

export function consumeUnmaskMcpSession(
  root,
  { home = zerohHome(), now = Date.now(), maxAgeMs = 60_000 } = {},
) {
  const file = mcpSessionClaimPath(root, home);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = acquireFileLock(`${file}.lock`);
  try {
    const sessionId = readSessionValue(file, root, { now, maxAgeMs });
    try {
      unlinkSync(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return sessionId;
  } finally {
    releaseFileLock(lock);
  }
}

function readSessionValue(file, root, { now, maxAgeMs }) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    const written = Date.parse(value.written_at);
    if (
      value.project !== path.resolve(root) ||
      typeof value.session_id !== 'string' ||
      !Number.isFinite(written) ||
      written > now ||
      now - written > maxAgeMs
    ) {
      return null;
    }
    return value.session_id;
  } catch {
    return null;
  }
}

function writeSessionValue(file, root, sessionId, now) {
  writePrivateJson(
    file,
    {
      project: path.resolve(root),
      session_id: String(sessionId),
      written_at: new Date(now).toISOString(),
    },
    { pretty: false },
  );
}

function signedPayload(document, field) {
  return { version: document.version, [field]: document[field] };
}

function readSigned(file, field, home) {
  if (!existsSync(file))
    return { value: null, status: 'missing', ignored: false };
  try {
    const document = JSON.parse(readFileSync(file, 'utf8'));
    const key = readFileSync(allowKeyPath(home));
    if (
      document?.version !== VERSION ||
      typeof document.hmac !== 'string' ||
      key.length !== 32 ||
      !Object.hasOwn(document, field)
    ) {
      return { value: null, status: 'invalid', ignored: true };
    }
    const expected = signatureFor(signedPayload(document, field), key);
    if (!signaturesMatch(document.hmac, expected)) {
      return { value: null, status: 'invalid', ignored: true };
    }
    return { value: document[field], status: 'verified', ignored: false };
  } catch {
    return { value: null, status: 'invalid', ignored: true };
  }
}

function writeSigned(file, field, value, home) {
  const key = loadOrCreateAllowKey(home);
  const payload = { version: VERSION, [field]: value };
  const document = { ...payload, hmac: signatureFor(payload, key) };
  writePrivateJson(file, document);
  return document;
}

function validCaps(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([kind, cap]) => isPersonalDataType(kind) && CAP_VALUES.includes(cap),
    )
  );
}

export function readCaps(home = zerohHome()) {
  const loaded = readSigned(capsFilePath(home), 'caps', home);
  if (!validCaps(loaded.value)) {
    return {
      caps: defaultCaps(),
      status: loaded.status,
      ignored: loaded.ignored,
    };
  }
  return {
    caps: { ...defaultCaps(), ...loaded.value },
    status: loaded.status,
    ignored: loaded.ignored,
  };
}

export function capFor(kind, home = zerohHome()) {
  const value = normaliseKind(kind);
  if (isSecretType(value)) return '0';
  if (!isPersonalDataType(value)) return null;
  return readCaps(home).caps[value];
}

export function writeCap(kind, cap, { home = zerohHome() } = {}) {
  const value = normaliseKind(kind);
  if (isSecretType(value)) {
    throw new Error(`${value} is a secret type and its cap is fixed at 0`);
  }
  if (!isPersonalDataType(value))
    throw new Error(`unknown personal-data kind: ${kind}`);
  if (!CAP_VALUES.includes(cap))
    throw new Error('cap must be one of 15m, 1h, session, or 0');
  const file = capsFilePath(home);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = acquireFileLock(`${file}.lock`);
  try {
    const caps = { ...readCaps(home).caps, [value]: cap };
    writeSigned(file, 'caps', caps, home);
    return caps;
  } finally {
    releaseFileLock(lock);
  }
}

export function durationOptionsForCap(cap) {
  if (cap === '0' || !CAP_VALUES.includes(cap)) return [];
  const maximum = CAP_VALUES.indexOf(cap);
  return DURATION_OPTIONS.filter(
    ({ value }) => CAP_VALUES.indexOf(value) <= maximum,
  );
}

// The unmask dialog for `kind` (T-32): every duration the cap allows, the
// shortest preselected; when the cap removes some, the dialog says so.
export function unmaskDialog(kind, reason, cap) {
  const options = durationOptionsForCap(cap);
  const limited =
    options.length > 0 && options.length < DURATION_OPTIONS.length
      ? `\nLonger durations are limited by your cap for ${kind}.`
      : '';
  return {
    options,
    message: `Claude asks to see real ${kind} values.\nWhy: ${String(reason).trim()}${limited}`,
  };
}

function validGrant(grant) {
  return (
    grant !== null &&
    typeof grant === 'object' &&
    typeof grant.id === 'string' &&
    isPersonalDataType(grant.kind) &&
    typeof grant.reason === 'string' &&
    typeof grant.granted_at === 'string' &&
    ((typeof grant.expires_at === 'string' && grant.session_id == null) ||
      (grant.expires_at == null && typeof grant.session_id === 'string'))
  );
}

function emptyGrantStore() {
  return { grants: [], receipts: [] };
}

export function readGrantStore(root = process.cwd(), home = zerohHome()) {
  const loaded = readSigned(grantsFilePath(root, home), 'store', home);
  const store = loaded.value;
  if (
    !store ||
    typeof store !== 'object' ||
    !Array.isArray(store.grants) ||
    !store.grants.every(validGrant) ||
    !Array.isArray(store.receipts)
  ) {
    return {
      ...emptyGrantStore(),
      status: loaded.status,
      ignored: loaded.ignored,
    };
  }
  return { ...store, status: loaded.status, ignored: loaded.ignored };
}

function saveGrantStore(root, home, store) {
  writeSigned(grantsFilePath(root, home), 'store', store, home);
  return store;
}

function grantId(kind, now) {
  return `ug_${now.toString(36)}_${createHash('sha256')
    .update(`${kind}:${now}:${randomBytes(16).toString('hex')}`)
    .digest('hex')
    .slice(0, 12)}`;
}

export function createGrant({
  root = process.cwd(),
  home = zerohHome(),
  kind,
  reason,
  duration,
  sessionId = envSessionId(),
  now = Date.now(),
} = {}) {
  const value = normaliseKind(kind);
  if (!isPersonalDataType(value))
    throw new Error(`cannot grant unmask for ${kind}`);
  const option = DURATION_OPTIONS.find((entry) => entry.value === duration);
  if (!option) throw new Error(`invalid unmask duration: ${duration}`);
  if (duration === 'session' && !sessionId) {
    throw new Error('session-scoped unmask needs a Claude session id');
  }
  const grantedAt = new Date(now).toISOString();
  const grant = {
    kind: value,
    reason: String(reason).trim(),
    granted_at: grantedAt,
    expires_at:
      option.milliseconds == null
        ? null
        : new Date(now + option.milliseconds).toISOString(),
    session_id: option.milliseconds == null ? String(sessionId) : null,
    id: grantId(value, now),
  };
  updateGrantStore(root, home, (loaded) => ({
    grants: [...loaded.grants, grant],
    receipts: [
      ...loaded.receipts,
      {
        action: 'grant',
        grant_id: grant.id,
        kind: grant.kind,
        reason: grant.reason,
        at: grantedAt,
      },
    ],
  }));
  return grant;
}

export function isGrantActive(
  grant,
  { sessionId = null, now = Date.now() } = {},
) {
  if (!validGrant(grant)) return false;
  if (grant.expires_at !== null) {
    const expires = Date.parse(grant.expires_at);
    return Number.isFinite(expires) && expires > now;
  }
  return !!sessionId && grant.session_id === String(sessionId);
}

export function activeGrants(
  root = process.cwd(),
  { home = zerohHome(), sessionId = null, now = Date.now() } = {},
) {
  return readGrantStore(root, home).grants.filter((grant) =>
    isGrantActive(grant, { sessionId, now }),
  );
}

// end_unmask (T-33): ends this project's grants for `kind` (or all of them)
// now. The model may call it without a dialog: ending early only reduces
// exposure. It never creates or extends a grant.
export function endGrants(
  root = process.cwd(),
  kind = 'all',
  { home = zerohHome(), now = Date.now() } = {},
) {
  const target = kind === 'all' ? 'all' : normaliseKind(kind);
  const ending = readGrantStore(root, home).grants.filter(
    (grant) => target === 'all' || grant.kind === target,
  );
  if (!ending.length) return [];
  const ids = new Set(ending.map(({ id }) => id));
  let ended = [];
  updateGrantStore(root, home, (loaded) => {
    ended = loaded.grants.filter(({ id }) => ids.has(id));
    const at = new Date(now).toISOString();
    return {
      grants: loaded.grants.filter(({ id }) => !ids.has(id)),
      receipts: [
        ...loaded.receipts,
        ...ended.map((grant) => ({
          action: 'revoke',
          grant_id: grant.id,
          kind: grant.kind,
          by: 'end_unmask',
          at,
        })),
      ],
    };
  });
  return ended;
}

export function revokeGrants(
  root = process.cwd(),
  target = 'all',
  { home = zerohHome(), now = Date.now() } = {},
) {
  let revoked = [];
  updateGrantStore(root, home, (loaded) => {
    revoked = loaded.grants.filter(
      (grant) => target === 'all' || grant.id === target,
    );
    if (target !== 'all' && revoked.length === 0) {
      throw new Error(`unmask grant not found: ${target}`);
    }
    const revokedIds = new Set(revoked.map(({ id }) => id));
    const at = new Date(now).toISOString();
    return {
      grants: loaded.grants.filter(({ id }) => !revokedIds.has(id)),
      receipts: [
        ...loaded.receipts,
        ...revoked.map((grant) => ({
          action: 'revoke',
          grant_id: grant.id,
          kind: grant.kind,
          at,
        })),
      ],
    };
  });
  return revoked;
}

function updateGrantStore(root, home, update) {
  const file = grantsFilePath(root, home);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = acquireFileLock(`${file}.lock`);
  try {
    const next = update(readGrantStore(root, home));
    return saveGrantStore(root, home, next);
  } finally {
    releaseFileLock(lock);
  }
}

export function recordRevealedUnderGrant({
  root = process.cwd(),
  home = zerohHome(),
  sessionId,
  grants,
  revealed,
  now = Date.now(),
} = {}) {
  if (!sessionId || !Array.isArray(revealed) || revealed.length === 0)
    return null;
  const grantByKind = new Map(grants.map((grant) => [grant.kind, grant]));
  const counts = new Map();
  for (const item of revealed) {
    const grant = grantByKind.get(item.type);
    if (!grant) continue;
    const current = counts.get(grant.id) ?? {
      grant_id: grant.id,
      kind: grant.kind,
      values: 0,
    };
    current.values += item.count ?? 1;
    counts.set(grant.id, current);
  }
  if (counts.size === 0) return null;
  const directory = sessionDir(root, sessionId);
  let latest;
  latest = readdirSync(directory)
    .map((name) => name.match(/^turn-(\d+)\.json$/u))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((left, right) => right - left)[0];
  if (!latest)
    throw new Error('cannot record an unmask reveal without a turn receipt');
  const file = path.join(directory, `turn-${latest}.json`);
  const lock = acquireFileLock(`${file}.lock`);
  try {
    const ledger = JSON.parse(readFileSync(file, 'utf8'));
    if (!ledger.receipt?.receipt_id) {
      throw new Error('cannot record an unmask reveal without a turn receipt');
    }
    const existing = new Map(
      (ledger.receipt.revealed_under_grant ?? []).map((entry) => [
        entry.grant_id,
        entry,
      ]),
    );
    for (const entry of counts.values()) {
      const previous = existing.get(entry.grant_id);
      existing.set(entry.grant_id, {
        grant_id: entry.grant_id,
        kind: entry.kind,
        tool_outputs: (previous?.tool_outputs ?? 0) + 1,
        values: (previous?.values ?? 0) + entry.values,
        last_revealed_at: new Date(now).toISOString(),
      });
    }
    const entries = [...existing.values()];
    const signaturePayload = {
      version: VERSION,
      receipt_id: ledger.receipt.receipt_id,
      revealed_under_grant: entries,
    };
    ledger.receipt.revealed_under_grant = entries;
    ledger.receipt.revealed_under_grant_hmac = signatureFor(
      signaturePayload,
      loadOrCreateAllowKey(home),
    );
    writePrivateJson(file, ledger);
    return entries;
  } finally {
    releaseFileLock(lock);
  }
}

export function initializeRevealReceiptExtension(
  receipt,
  { home = zerohHome() } = {},
) {
  if (!receipt?.receipt_id) {
    throw new Error('cannot initialize an unmask extension without a receipt');
  }
  const entries = receipt.revealed_under_grant ?? [];
  receipt.revealed_under_grant = entries;
  receipt.revealed_under_grant_hmac = signatureFor(
    {
      version: VERSION,
      receipt_id: receipt.receipt_id,
      revealed_under_grant: entries,
    },
    loadOrCreateAllowKey(home),
  );
  return receipt;
}

export function formatGrantTimeLeft(grant, now = Date.now()) {
  if (grant.expires_at == null) return 'until session ends';
  const milliseconds = Math.max(0, Date.parse(grant.expires_at) - now);
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} hr ${remainder} min left` : `${hours} hr left`;
  }
  return `${minutes} min left`;
}

export function formatStatusline(grants, now = Date.now()) {
  return grants
    .map(
      (grant) => `${grant.kind} unmasked · ${formatGrantTimeLeft(grant, now)}`,
    )
    .join(' · ');
}

const END_EARLY =
  'to end it early, tell Claude or run /zeroh-disclosure:unmask revoke';

export function durationResultText(grant, durationLabel) {
  if (grant.expires_at == null) {
    return `${grant.kind} unmasked until the session ends · ${END_EARLY}`;
  }
  const expiry = new Date(grant.expires_at);
  const clock = expiry.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${grant.kind} unmasked for ${durationLabel}, until ${clock} · ${END_EARLY}`;
}

export function capSummary(home = zerohHome()) {
  const loaded = readCaps(home);
  return {
    ...loaded,
    caps: {
      ...loaded.caps,
      ...Object.fromEntries(SECRET_TYPES.map((kind) => [kind, '0 (fixed)'])),
    },
  };
}
