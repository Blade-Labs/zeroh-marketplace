// SPDX-License-Identifier: AGPL-3.0-only

// Turn and Stop-line rendering for local receipts.
import path from 'node:path';
import {
  isPersonalType,
  observationFrom,
  plural,
  rows,
  SOURCE_WORDS,
  sourcePlace,
  sumCounts,
} from '../report-counts.js';
import { isSecretType, tokenType } from '../data-kinds.js';
import { kindName } from '../kind-name.js';
import { displayPath } from '../private-fs.js';
import {
  previewValue,
  revealedUnderGrantCount,
  signingLabel,
} from '../report-slip.js';
import {
  normalizeTokenObservations,
  promptSentUnmasked,
  promptStopped,
  sentUnmaskedCount,
  signedTurnSummary,
  turnSummary,
  uniqueReplacements,
} from '../turn-summary.js';
import {
  TOKEN_REASONS,
  UNCHECKED_LABELS,
  uncheckedCounts,
} from '../unchecked.js';
import { scrub } from '../../shell-analysis/secrets.js';
import { verifyReceiptArtifact } from '../verify-receipt.js';

export const DEFAULT_POLICY_ID = 'zeroh-disclosure-v1';
export const DEFAULT_ENGINE_ID = 'regex-local';

// The values a turn masked: distinct tokens of its prompt (unless the prompt
// was stopped or sent unmasked) and of the tool output it masked.
export function turnMaskedCount(
  ledger,
  { blocked = null, sentUnmasked = null } = {},
) {
  const stopped = blocked ?? promptStopped(ledger);
  sentUnmasked ??= promptSentUnmasked(ledger);
  // A stopped prompt never reached the model, so its values count as stopped,
  // not masked.
  return new Set([
    ...(stopped || sentUnmasked
      ? []
      : uniqueReplacements(ledger?.replacements ?? [])
    )
      .map((entry) => entry.token)
      .filter(Boolean),
    ...(ledger?.audit?.masked?.tokens ?? []),
    ...tokenObservationsFromLedger(ledger).map((entry) => entry.token),
  ]).size;
}

// Hosts that received a restored value: checked and not blocked.
function allowedDestinations(destinations) {
  const checked = destinations?.checked ?? {};
  const blocked = destinations?.blocked ?? {};
  return Object.keys(checked)
    .filter(
      (host) => (Number(checked[host]) || 0) > (Number(blocked[host]) || 0),
    )
    .sort();
}

// What a turn has to report at Stop, or an empty list when it has nothing: no
// value masked, no prompt stopped, no destination blocked or allowed a real
// value, no value shown under
// a grant, no file passed unchecked and no missed value reported.
export function stopTurnEvents(
  ledger,
  { blocked = null, sentUnmasked = null } = {},
) {
  const events = [];
  const stopped = blocked ?? promptStopped(ledger);
  const masked = turnMaskedCount(ledger, { blocked: stopped, sentUnmasked });
  if (masked > 0) events.push(`${masked} ${plural(masked, 'value')} masked`);
  if (stopped) events.push('prompt stopped');
  const destinations = sumCounts(ledger?.audit?.destinations?.blocked);
  if (destinations > 0) {
    events.push(
      `${destinations} ${plural(destinations, 'destination')} blocked`,
    );
  }
  // A real value put back into a tool call for a host the allow rules permit
  // (the command may still have been refused by Claude Code afterwards).
  const allowed = allowedDestinations(ledger?.audit?.destinations);
  if (allowed.length > 0) {
    const shown = allowed.slice(0, 3).join(', ');
    const more = allowed.length > 3 ? ` and ${allowed.length - 3} more` : '';
    events.push(
      `real ${plural(allowed.length, 'value')} allowed to ${shown}${more}`,
    );
  }
  const typedSent = sentUnmaskedCount(ledger);
  if (typedSent > 0) {
    events.push(
      `${typedSent} ${plural(typedSent, 'value')} sent to Claude as typed`,
    );
  }
  const revealed = revealedUnderGrantCount(ledger);
  if (revealed > 0) {
    events.push(
      `${revealed} ${plural(revealed, 'value')} shown under your unmask`,
    );
  }
  const unchecked = sumCounts(ledger?.format_disclosure?.passed_unmasked);
  if (unchecked > 0) {
    events.push(`${unchecked} ${plural(unchecked, 'file')} passed unchecked`);
  }
  // Operations passed unprotected in the default uncertain mode (pass), and
  // those that ran with the token instead of the value (nothing leaked).
  const byReason = uncheckedCounts(ledger?.audit);
  let passed = 0;
  let tokenRan = 0;
  for (const [reason, count] of Object.entries(byReason)) {
    if (TOKEN_REASONS.has(reason)) tokenRan += count;
    else passed += count;
  }
  if (passed > 0) {
    events.push(
      `${passed} ${plural(passed, 'operation')} not protected (see the receipt)`,
    );
  }
  if (tokenRan > 0) {
    events.push(
      `${tokenRan} ${plural(tokenRan, 'operation')} ran with the token, not your key`,
    );
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
  { blocked = null, sentUnmasked = null } = {},
) {
  const events = stopTurnEvents(ledger, { blocked, sentUnmasked });
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

// What the model saw in a turn (T-20), for a second Stop line (1.0.1):
// up to three examples, one kind each (keys and passwords first), as the
// token (next to a preview for personal data), then the rest counted by
// kind and where it came from, in plain words:
//
//   Claude saw ⟦API_KEY-3f9a1c⟧ in .env (…c4Q2) · ⟦EMAIL-29c405⟧, not
//   a…@acme.com · and 10 more: 8 email addresses in signup-errors.log, 2
//   Stripe test secret keys in .env (receipt ↗ / /zeroh-disclosure:mask-show)
//
// Claude Code keeps a Stop hook's systemMessage in the session transcript
// on disk (a `hook_system_message` attachment), so the line never holds a
// value and never the start of a secret (stopPreview). Without the vault's
// value, an example says where the token came from instead. Null when the
// turn masked nothing the model saw.
const STOP_EXAMPLES = 3;
const STOP_GROUPS = 3;

function pluralWords(name, count) {
  if (count === 1) return name;
  if (name === 'date of birth') return 'dates of birth';
  const words = name.split(' ');
  // "Malaysian NRIC (MyKad) number": the noun is the last plain word.
  const at = words.length - 1;
  const noun = words[at];
  words[at] = /(?:s|x|z|ch|sh)$/u.test(noun)
    ? `${noun}es`
    : /[^aeiou]y$/u.test(noun)
      ? `${noun.slice(0, -1)}ies`
      : `${noun}s`;
  return words.join(' ');
}

function stopKindName(type, value) {
  const name = kindName(type, value ?? '');
  if (name === 'secret' && String(type).toUpperCase() === 'API_KEY')
    return 'API key';
  return name;
}

// The Stop line is stored in Claude Code's session transcript (docs/
// architecture.md, "What the Stop line may show"), so a key, password, token,
// connection string or any other secret shows no part of its start: at most
// its last four characters, and only when it is 24 characters or longer.
// Personal data keeps receipt.html's preview (`a…@domain`, `TYPE …NN`).
const STOP_TAIL_MIN = 24;
export function stopPreview(type, value) {
  const text = String(value ?? '');
  if (isPersonalType(type)) {
    const preview = previewValue(type, text);
    return { preview: preview && preview !== '•••' ? preview : null };
  }
  return {
    preview: null,
    tail: text.length >= STOP_TAIL_MIN ? text.slice(-4) : null,
  };
}

export function formatStopTokenLine(
  ledger,
  { blocked = null, sentUnmasked = null, valueOf = null } = {},
) {
  if (blocked ?? promptStopped(ledger)) return null;
  // A prompt sent as typed: the model saw the value, not a token.
  const typedMasked = !(sentUnmasked ?? promptSentUnmasked(ledger));
  const seen = new Map();
  for (const entry of tokenObservationsFromLedger(ledger)) {
    if (!typedMasked && entry.channel === 'typed prompt') continue;
    if (!seen.has(entry.token))
      seen.set(entry.token, { type: entry.type, place: sourcePlace(entry) });
  }
  for (const replacement of typedMasked ? (ledger?.replacements ?? []) : []) {
    const token = replacement?.replacement;
    if (token && !seen.has(token))
      seen.set(token, {
        type: replacement.entity_type || tokenType(token),
        place: SOURCE_WORDS['typed prompt'],
      });
  }
  if (!seen.size) return null;
  const items = [...seen].map(([token, { type, place }]) => {
    let value = null;
    try {
      value = valueOf ? valueOf(token) : null;
    } catch {
      value = null;
    }
    const preview = value == null ? null : stopPreview(type, value);
    return {
      token,
      type,
      place,
      kind: stopKindName(type, value),
      ...preview,
    };
  });
  // Keys and passwords first, then personal data; one example per kind
  // before a second of any kind.
  const ordered = [
    ...items.filter((item) => isSecretType(item.type)),
    ...items.filter((item) => !isSecretType(item.type)),
  ];
  const examples = [];
  const kinds = new Set();
  for (const item of ordered) {
    if (examples.length >= STOP_EXAMPLES) break;
    if (kinds.has(item.kind)) continue;
    kinds.add(item.kind);
    examples.push(item);
  }
  for (const item of ordered) {
    if (examples.length >= STOP_EXAMPLES) break;
    if (!examples.includes(item)) examples.push(item);
  }
  const shown = examples.map(
    (item) =>
      `⟦${item.token.slice(1, -1)}⟧${item.preview ? `, not ${item.preview}` : ` ${item.place}${item.tail ? ` (…${item.tail})` : ''}`}`,
  );
  const rest = ordered.filter((item) => !examples.includes(item));
  if (!rest.length) return `Claude saw ${shown.join(' · ')}`;
  const groups = new Map();
  for (const item of rest) {
    const key = `${item.kind}\u0000${item.place}`;
    const group = groups.get(key) ?? { ...item, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  const listed = [...groups.values()].sort((a, b) => b.count - a.count);
  const named = listed
    .slice(0, STOP_GROUPS)
    .map((g) => `${g.count} ${pluralWords(g.kind, g.count)} ${g.place}`);
  const others = listed
    .slice(STOP_GROUPS)
    .reduce((sum, group) => sum + group.count, 0);
  if (others > 0) named.push(`${others} other${others === 1 ? '' : 's'}`);
  return `Claude saw ${shown.join(' · ')} · and ${rest.length} more: ${named.join(', ')} (receipt ↗ / /zeroh-disclosure:mask-show)`;
}

export function uncheckedRows(counts) {
  return rows(counts ?? {}, 'reason').map((entry) => ({
    ...entry,
    label: UNCHECKED_LABELS[entry.reason] ?? entry.reason,
  }));
}

// A turn's numbers as the receipt shows them. A turn finalised by 1.0.0 or
// later shows its signed summary (packages/zeroh-disclosure-core/turn-summary.js), so what is shown is
// what is signed; a turn still in progress, or written before 1.0.0, shows
// the ledger's counts, and `coverage` says which it is.
export function shownTurnSummary(ledger) {
  const signed = signedTurnSummary(ledger)?.summary;
  if (signed) return { summary: signed, coverage: 'turn' };
  const required = Boolean(
    ledger?.receipt?.public_claims?.turn_summary_extension,
  );
  return {
    summary: turnSummary(ledger),
    coverage: required ? 'pending' : 'typed-prompt',
  };
}

export async function summarizeTurn(
  { turn, ledger, file },
  vault = null,
  verification = null,
) {
  verification ??= await verifyReceiptArtifact(file).catch(() => ({
    ok: false,
    checks: [],
  }));
  const { summary, coverage } = shownTurnSummary(ledger);
  const claims = ledger.receipt?.public_claims ?? {};
  const tokenMap = (summary.token_map ?? []).map((entry) => ({
    ...entry,
    source: maskStoredLabel(entry.source, vault),
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
    coverage: verification.coverage ?? coverage,
    values_masked: summary.values_masked,
    values_sent: summary.values_sent,
    sent_typed: summary.sent_unmasked?.count ?? 0,
    sent_under_grant: summary.sent_under_grant ?? summary.values_sent,
    masked_by_type: { ...summary.masked_by_type },
    masked_by_channel: { ...summary.masked_by_channel },
    masked_by_channel_totals: Object.fromEntries(
      Object.entries(summary.masked_by_channel).map(([channel, counts]) => [
        channel,
        sumCounts(counts),
      ]),
    ),
    tokens: [...summary.tokens],
    token_map: tokenMap,
    destinations_checked: { ...summary.destinations_checked },
    destinations_blocked: { ...summary.destinations_blocked },
    formats_passed_unmasked: { ...summary.formats_passed_unmasked },
    formats_withheld: { ...summary.formats_withheld },
    passed_unchecked: { ...summary.passed_unchecked },
    verified: !!verification.ok,
    failed_checks:
      verification.failed ?? (verification.ok ? [] : ['receipt_readable']),
    signature_ok: !!verification.checks?.find(
      (entry) => entry.name === 'signature',
    )?.ok,
  };
}

export function tokenObservationsFromLedger(ledger) {
  return normalizeTokenObservations(ledger?.audit?.masked?.token_map ?? []);
}

// Receipts written before 1.0.0-rc.2 stored sources and file keys as the
// hook saw them, so a sensitive file name or command could sit there in plain
// text (Astra finding 9). Everything read back is masked again before it is
// shown: with the project's vault when there is one (its tokens), otherwise
// with a stand-in that names only the kind. Nothing is minted or saved.
const LABEL_ONLY_VAULT = Object.freeze({
  tokenFor: (type) => `[${type}]`,
});

export function maskStoredLabel(text, vault = null) {
  const value = String(text ?? '');
  if (!value) return value;
  try {
    return scrub(value, { vault: vault ?? LABEL_ONLY_VAULT, profile: 'tool' })
      .text;
  } catch {
    return '(label withheld)';
  }
}

function previewForToken(vault, token, type) {
  if (!vault) return '•••';
  const value = vault.valueOf(token);
  return value == null ? '•••' : previewValue(type, value);
}

export function buildSessionTokenMap(summaries) {
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

function recordDate(record) {
  const value =
    record.finalized_at ||
    record.created_at ||
    record.receipt?.public_claims?.iat;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
