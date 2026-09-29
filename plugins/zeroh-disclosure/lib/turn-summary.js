// SPDX-License-Identifier: AGPL-3.0-only

// The signed turn summary: every number a receipt shows for one turn (typed
// prompt, tool output and file reads masked, values sent, destinations,
// formats and operations passed unchecked, misses reported), computed from
// the turn ledger in one place and signed at Stop with the session's
// receipt key. The receipt signed at UserPromptSubmit covers only the typed
// prompt; its `turn_summary_extension` claim says a signed summary is
// required, so `verify` fails when the summary is missing, was signed for
// another receipt, or any number in the ledger no longer matches it.
// Receipts written before 1.0.0 have no such claim and verify as before,
// labelled as covering the typed prompt only.
import { canonicalJson, sha256B64u } from './crypto.js';
import { add, mergeCounts, sumCounts } from './report-counts.js';
import { revealedUnderGrantCount } from './report-slip.js';
import {
  createSignedReceipt,
  decodeCompactReceipt,
  verifyCompactReceiptSignature,
} from './selective-disclosure.js';
import { uncheckedCounts } from './unchecked.js';

export const TURN_SUMMARY_SCHEMA = 'zeroh-turn-summary/v1';

// The fields of a v1 summary, frozen with 1.0.0 (docs/receipt-format.md):
// a summary verifies only with exactly these. A new field is a new schema,
// `zeroh-turn-summary/v2`, with its own field list here; the verifier picks
// the list by the summary's `schema`, so a v1 summary keeps verifying.
export const TURN_SUMMARY_FIELDS = Object.freeze([
  'prompt',
  'values_masked',
  'values_sent',
  'sent_unmasked',
  'sent_under_grant',
  'masked_by_type',
  'masked_by_channel',
  'tokens',
  'token_map',
  'files',
  'destinations_checked',
  'destinations_blocked',
  'formats_passed_unmasked',
  'formats_withheld',
  'passed_unchecked',
  'misses_reported',
  'values_sent_to_ai_provider',
]);
const SUMMARY_FIELDS = Object.freeze({
  [TURN_SUMMARY_SCHEMA]: TURN_SUMMARY_FIELDS,
});

// What happened to the turn's prompt, from its phase until Stop finalises
// the turn, and always from the signed receipt: `decision_action` is a
// public claim (`mask_and_allow` when the proxy masked it, `allow` when it
// went as typed, `block` when it was stopped); the full decision
// (`decision_details.enforced`) is a selective claim, used when present.
function promptDecision(ledger) {
  const claims = ledger?.receipt?.public_claims ?? {};
  return {
    action: claims.decision_action ?? null,
    enforced: claims.decision_details?.enforced ?? null,
  };
}

// True when the turn's prompt went to the model as typed (no proxy in the
// route, uncertain: pass). Its replacements are only the ledger's masked
// copy: nothing in them was masked for the model (Astra rc.2 F6).
export function promptSentUnmasked(ledger) {
  const { action, enforced } = promptDecision(ledger);
  return (
    ledger?.phase === 'sent_unmasked_no_proxy' ||
    enforced === 'sent_unmasked' ||
    (action === 'allow' && (ledger?.replacements ?? []).length > 0)
  );
}

// True when the turn's prompt was stopped: nothing was sent, and its
// replacements are only the masked copy offered for resubmission.
export function promptStopped(ledger) {
  const { action, enforced } = promptDecision(ledger);
  return (
    String(ledger?.phase).startsWith('blocked_') ||
    enforced === 'stopped' ||
    action === 'block'
  );
}

export function uniqueReplacements(replacements) {
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

// The prompt's replacements that were masked in what reached the model:
// none for a prompt that was stopped or sent as typed.
export function promptMaskedReplacements(ledger) {
  return promptStopped(ledger) || promptSentUnmasked(ledger)
    ? []
    : uniqueReplacements(ledger?.replacements ?? []);
}

export function normalizeTokenObservations(observations) {
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

export function countReplacementTypes(replacements) {
  const counts = {};
  for (const replacement of replacements)
    add(counts, replacement.type, replacement.count);
  return counts;
}

// Distinct values the typed prompt sent to the model as typed (no proxy
// in the route, uncertain: pass), deduped by value; UserPromptSubmit writes
// audit.sent_unmasked = { count, by_type }.
export function sentUnmaskedCount(ledger) {
  const count = Number(ledger?.audit?.sent_unmasked?.count);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

// "Sent" everywhere (status line, Stop line, slip, /report): values that
// reached the model in plain text, typed and sent unmasked plus values shown
// under an unmask grant the user approved.
export function turnValuesSent(ledger) {
  return sentUnmaskedCount(ledger) + revealedUnderGrantCount(ledger);
}

function countsOf(value) {
  const out = {};
  mergeCounts(out, value ?? {});
  return out;
}

// Every number the receipt shows for one turn, from its ledger.
export function turnSummary(ledger) {
  const prompt = promptMaskedReplacements(ledger);
  const maskedByChannel = {};
  if (prompt.length)
    maskedByChannel['typed prompt'] = countReplacementTypes(prompt);
  for (const [channel, counts] of Object.entries(
    ledger?.audit?.masked?.by_channel ?? {},
  )) {
    const copy = countsOf(counts);
    if (Object.keys(copy).length) maskedByChannel[channel] = copy;
  }
  const maskedByType = {};
  for (const counts of Object.values(maskedByChannel))
    mergeCounts(maskedByType, counts);
  const stopped = promptStopped(ledger);
  const sentUnmasked = promptSentUnmasked(ledger);
  return {
    prompt: stopped ? 'stopped' : sentUnmasked ? 'sent_unmasked' : 'sent',
    values_masked: sumCounts(maskedByType),
    values_sent: turnValuesSent(ledger),
    sent_unmasked: {
      count: sentUnmaskedCount(ledger),
      by_type: countsOf(ledger?.audit?.sent_unmasked?.by_type),
    },
    sent_under_grant: revealedUnderGrantCount(ledger),
    masked_by_type: maskedByType,
    masked_by_channel: maskedByChannel,
    tokens: [
      ...new Set([
        ...prompt.map((entry) => entry.token).filter(Boolean),
        ...(ledger?.audit?.masked?.tokens ?? []),
      ]),
    ].sort(),
    token_map: normalizeTokenObservations(
      ledger?.audit?.masked?.token_map ?? [],
    ),
    files: countsOf(ledger?.audit?.files),
    destinations_checked: countsOf(ledger?.audit?.destinations?.checked),
    destinations_blocked: countsOf(ledger?.audit?.destinations?.blocked),
    formats_passed_unmasked: countsOf(
      ledger?.format_disclosure?.passed_unmasked,
    ),
    formats_withheld: countsOf(ledger?.format_disclosure?.withheld),
    passed_unchecked: uncheckedCounts(ledger?.audit),
    misses_reported: Math.max(0, Number(ledger?.audit?.misses_reported) || 0),
    // A value ZeroH found reached the model in plain text this turn: the
    // prompt went as typed, or a value was shown under an unmask grant
    // (the "sent" definition, docs/receipt-format.md). Named apart from the
    // prompt receipt's `raw_content_sent_to_ai_provider`, which covers the
    // typed prompt only.
    values_sent_to_ai_provider: sentUnmasked || turnValuesSent(ledger) > 0,
  };
}

// Signs the turn's summary with the session key, bound to its receipt.
// Stored in the ledger as `turn_summary` ({ schema, compact }).
export async function signTurnSummary({ ledger, turn, signer }) {
  const receipt = ledger?.receipt;
  if (!receipt?.receipt_id) throw new Error('turn has no signed receipt');
  const signed = await createSignedReceipt({
    signer,
    publicClaims: {
      schema: TURN_SUMMARY_SCHEMA,
      receipt_id: receipt.receipt_id,
      receipt_hash:
        receipt.receipt_hash ?? (await sha256B64u(receipt.compact ?? '')),
      turn,
      iat: new Date().toISOString(),
      summary: turnSummary(ledger),
    },
    selectiveClaims: {},
  });
  return { schema: TURN_SUMMARY_SCHEMA, compact: signed.compact };
}

// The signed summary's claims, or null when there is none or it is not
// readable. Not a verification: verifyTurnSummary checks the signature.
export function signedTurnSummary(ledger) {
  try {
    const compact = ledger?.turn_summary?.compact;
    if (!compact) return null;
    const claims = decodeCompactReceipt(compact)[`pay${'load'}`];
    return claims?.schema === TURN_SUMMARY_SCHEMA ? claims : null;
  } catch {
    return null;
  }
}

// Checks one turn's signed summary against its receipt: signed by the
// receipt's issuer key, bound to this receipt, and (when the ledger's
// counts are at hand) equal to what the ledger says now.
// Returns { ok, detail, claims }.
export async function verifyTurnSummary({
  record,
  receiptClaims,
  receiptHash,
  compareLedger = true,
}) {
  const compact = record?.turn_summary?.compact;
  if (!compact) return { ok: false, detail: 'signed turn summary missing' };
  let claims;
  try {
    claims = decodeCompactReceipt(compact)[`pay${'load'}`];
  } catch (error) {
    return { ok: false, detail: `unreadable turn summary: ${error.message}` };
  }
  const signature = await verifyCompactReceiptSignature(
    compact,
    receiptClaims.issuer_public_jwk,
  );
  if (!signature.ok)
    return { ok: false, detail: 'turn summary signature does not verify' };
  const fields = Object.hasOwn(SUMMARY_FIELDS, claims?.schema ?? '')
    ? SUMMARY_FIELDS[claims.schema]
    : null;
  if (!fields)
    return { ok: false, detail: `got ${claims?.schema || 'missing'} schema` };
  const signedFields = Object.keys(claims.summary ?? {}).sort();
  if (canonicalJson(signedFields) !== canonicalJson([...fields].sort())) {
    return {
      ok: false,
      detail: `the summary's fields are not those of ${claims.schema}`,
      claims,
    };
  }
  if (
    claims.receipt_id !== receiptClaims.receipt_id ||
    claims.receipt_hash !== receiptHash
  ) {
    return { ok: false, detail: 'turn summary signed for another receipt' };
  }
  if (compareLedger) {
    const now = turnSummary(record);
    if (canonicalJson(now) !== canonicalJson(claims.summary)) {
      const changed = Object.keys({ ...now, ...claims.summary }).filter(
        (key) =>
          canonicalJson(now[key]) !== canonicalJson(claims.summary?.[key]),
      );
      return {
        ok: false,
        detail: `the turn's ${changed.join(', ')} differ from the signed summary`,
        claims,
      };
    }
  }
  return { ok: true, claims };
}
