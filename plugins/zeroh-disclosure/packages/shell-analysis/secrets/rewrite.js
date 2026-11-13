// SPDX-License-Identifier: AGPL-3.0-only

import {
  detectSensitiveData,
  looksLikeCodeValue,
} from '../../zeroh-disclosure-core/detector.js';
import {
  MASKED_TOKEN_RE,
  NAMED_TOKEN_RE,
  TOKEN_RE,
} from '../../zeroh-disclosure-core/token-pattern.js';

export function variants(secret) {
  const out = [];
  const b64 = Buffer.from(secret.value, 'utf8').toString('base64');
  const b64url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hex = Buffer.from(secret.value, 'utf8').toString('hex');
  const url = encodeURIComponent(secret.value);
  if (b64.length >= 12)
    out.push({ value: b64, type: `${secret.type}_ENCODED` });
  if (b64url !== b64 && b64url.length >= 12)
    out.push({ value: b64url, type: `${secret.type}_ENCODED` });
  if (hex.length >= 16) out.push({ value: hex, type: `${secret.type}_HEX` });
  if (url !== secret.value) out.push({ value: url, type: secret.type });
  return out;
}

export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- exact values ------------------------------------------------------------
//
// Every live vault value is matched exactly in new text, whatever its source
// (known, detected from context, typed, reported), together with its encoded
// forms. A value masked once because of its surroundings (`db_password = …`,
// a Bearer header) stays masked when it comes back bare: printed by a
// late-bound command, written into a file and read again, or pasted.

export const EXACT_KEY = 4; // bucket key length; also the shortest value matched
export const MIN_VAULT_EXACT = 6; // vault-only values shorter than this are too common
export const MAX_VARIANT_SOURCE = 4096; // no encodings of whole files
// 0.x masked tool output with the loose typed-prompt rules, so a vault can hold
// digit runs as detected PHONE_NUMBER, QATAR_ID or ACCOUNT_NUMBER entries. Tool
// output is never detected with those rules now; exact-matching the leftovers
// would bring that mangling back. Vaults written before 1.0 also hold PERSON
// entries from the removed capitalised-words rule ("Getting Started"), under
// any channel source; a PERSON value is matched exactly only when the user
// reported it.
export const LOOSE_TYPES = new Set(['QATAR_ID', 'ACCOUNT_NUMBER']);

export function baseType(type) {
  return String(type).replace(/_(?:ENCODED|HEX)$/u, '');
}

// One ordinary prose word: ASCII letters, all lowercase or with one leading
// capital, at most 24 of them, and one sentence mark after it
// (`password=<word>?`). A hyphen, an apostrophe, a digit, an inner symbol
// or a capital inside makes it a typed password, not a word
// (`orchard-river-copper-lantern!`, `WqRtYuIoPaSdFgHj`): those keep bare
// matching (Astra detector-exceptions review, finding 5).
export const PLAIN_WORD = /^[A-Za-z][a-z]+[?!.,]?$/u;
export const PLAIN_WORD_MAX = 24;
export const plainWord = (value) =>
  value.length <= PLAIN_WORD_MAX + 1 &&
  PLAIN_WORD.test(value) &&
  value.replace(/[?!.,]$/u, '').length <= PLAIN_WORD_MAX;

export function exactFromVault(entry) {
  if (entry.matchScope === 'in-context') return false;
  const value = entry.value;
  if (typeof value !== 'string' || value.length < MIN_VAULT_EXACT) return false;
  const source = entry.source ?? 'detected';
  if (entry.matchScope === 'bare') return true;
  if (entry.type === 'PERSON' && !source.startsWith('reported:')) return false;
  // A single plain word found by its surroundings, typed (`password=<word>`
  // in a prompt) or in a file or output, is masked where its key names it:
  // the detector finds it there again and the vault gives it the same token.
  // It is never exact-matched bare, which would mask that word in all later
  // code and prose. Vault entries written before 1.0.0 stop matching bare
  // too. A known (`.env`, credential file) or reported word still matches
  // everywhere.
  if ((source === 'prompt' || source === 'detected') && plainWord(value))
    return false;
  if (source === 'detected') {
    if (LOOSE_TYPES.has(entry.type)) return false;
    // A key-name finding from before 1.0 that was code (`API_KEY`,
    // `CSSToken`, `process.env.X!`): matching it would mask identifiers.
    if (looksLikeCodeValue(value)) return false;
    if (entry.type === 'PHONE_NUMBER' && !value.trim().startsWith('+'))
      return false;
  }
  return true;
}

// A value found by its surroundings (not a `.env` or credential-file value,
// nor an encoded form) matches only as a whole word: `hunter2abc` in
// `pw=hunter2abc`, not inside `hunter2abcdef` or `MY_hunter2abc`.
export const WORD_CHAR = /[A-Za-z0-9_$]/u;

export function atWordBoundaries(text, start, end) {
  const first = text[start];
  const last = text[end - 1];
  if (WORD_CHAR.test(first) && start > 0 && WORD_CHAR.test(text[start - 1]))
    return false;
  if (WORD_CHAR.test(last) && end < text.length && WORD_CHAR.test(text[end]))
    return false;
  return true;
}

export function boundedCandidate(candidate) {
  return (
    !String(candidate.source ?? '').startsWith('known:') &&
    !/_(?:ENCODED|HEX)$/u.test(candidate.type)
  );
}

export class ExactMatcher {
  constructor() {
    this.buckets = new Map();
    this.values = new Set();
  }

  add(input) {
    const { value } = input;
    if (typeof value !== 'string' || value.length < EXACT_KEY) return;
    if (this.values.has(value)) return;
    this.values.add(value);
    const candidate = { ...input, bounded: boundedCandidate(input) };
    const key = value.slice(0, EXACT_KEY);
    const bucket = this.buckets.get(key);
    if (!bucket) {
      this.buckets.set(key, [candidate]);
      return;
    }
    // Longest first, so the longest value at a position wins.
    let index = bucket.findIndex((c) => c.value.length < value.length);
    if (index < 0) index = bucket.length;
    bucket.splice(index, 0, candidate);
  }

  addWithVariants(candidate) {
    this.add(candidate);
    if (
      candidate.value.length > MAX_VARIANT_SOURCE ||
      /_(?:ENCODED|HEX)$/u.test(candidate.type)
    ) {
      return;
    }
    for (const variant of variants(candidate))
      this.add({ ...variant, source: candidate.source });
  }

  // Leftmost-longest, non-overlapping matches outside `blocked` spans.
  find(text, blocked = []) {
    const hits = [];
    if (!this.buckets.size || text.length < EXACT_KEY) return hits;
    // A vault exact value is still certain inside a gateway-shaped wrapper.
    // Its label separator must not defeat the ordinary word-boundary guard.
    // Shape is enough to strengthen exact-value protection here. It grants
    // no masking exemption; only the recognized type vocabulary does that.
    const gateways = spansOf(
      text,
      /<[^<>\r\n]+?_(?:[0-9a-f]{64}|[0-9a-f]{32}|[0-9a-f]{16})>/gu,
    );
    let g = 0;
    let b = 0;
    for (let i = 0; i + EXACT_KEY <= text.length; i += 1) {
      while (b < blocked.length && blocked[b][1] <= i) b += 1;
      if (b < blocked.length && blocked[b][0] <= i) {
        i = blocked[b][1] - 1;
        continue;
      }
      while (g < gateways.length && gateways[g][1] <= i) g += 1;
      const bucket = this.buckets.get(text.slice(i, i + EXACT_KEY));
      if (!bucket) continue;
      for (const candidate of bucket) {
        const end = i + candidate.value.length;
        if (!text.startsWith(candidate.value, i)) continue;
        if (b < blocked.length && blocked[b][0] < end) continue;
        const insideGateway =
          g < gateways.length && gateways[g][0] <= i && gateways[g][1] >= end;
        if (
          candidate.bounded &&
          !insideGateway &&
          !atWordBoundaries(text, i, end)
        )
          continue;
        hits.push({ start: i, end, candidate });
        i = end - 1;
        break;
      }
    }
    return hits;
  }
}

// One matcher per vault and `known` list, built once and extended as the vault
// grows, so a process scrubbing many strings (the proxy, a notebook) pays for
// the vault once.
export const matchers = new WeakMap();

// Callers without a `known` list (scrub's default, the receipt's stored-label
// masking) pass a new empty array each time; one shared empty list keeps them
// on the vault's memo instead of rebuilding the matcher per call (phase 789).
const NO_KNOWN = Object.freeze([]);

export function exactMatcher(vault, known) {
  if (known == null || (Array.isArray(known) && known.length === 0))
    known = NO_KNOWN;
  const entries = vault?.entries instanceof Map ? vault.entries : null;
  let cached = vault ? matchers.get(vault) : null;
  const build = () => {
    const matcher = new ExactMatcher();
    for (const s of known)
      matcher.addWithVariants({
        value: s.value,
        type: s.type,
        source: `known:${s.name}`,
      });
    cached = { matcher, known, entries, seen: new Map() };
    if (vault) matchers.set(vault, cached);
  };
  if (!cached || cached.known !== known || cached.entries !== entries) build();
  if (entries) {
    // Vault.touch and refreshKnown replace an entry object in place (a new
    // last_used, or a source upgraded to known: or reported:), so each entry
    // is compared by identity. A change that leaves its exact-match decision
    // as it was costs nothing. A new entry is appended, as a fresh build in
    // vault order would add it last. Any changed decision for an entry
    // already seen rebuilds the matcher in vault order: the matcher keeps the
    // first candidate for each value (and its encodings), and that candidate
    // decides the word-boundary rule. Decision changes are rare.
    let rebuild = false;
    const pending = [];
    for (const [token, entry] of entries) {
      const prior = cached.seen.get(token);
      if (prior?.entry === entry) continue;
      const exact = exactFromVault(entry);
      const candidate = {
        value: entry.value,
        type: entry.type,
        source: entry.source ?? 'detected',
      };
      const bounded = boundedCandidate(candidate);
      cached.seen.set(token, { entry, exact, bounded });
      if (!prior) {
        if (exact) pending.push(candidate);
      } else if (
        prior.exact !== exact ||
        (exact && prior.bounded !== bounded)
      ) {
        rebuild = true;
      }
    }
    if (rebuild) {
      build();
      return exactMatcher(vault, known);
    }
    for (const candidate of pending) cached.matcher.addWithVariants(candidate);
  } else if (!entries && vault?.knownValues) {
    for (const entry of vault.knownValues()) {
      if (!exactFromVault(entry)) continue;
      cached.matcher.addWithVariants({
        value: entry.value,
        type: entry.type,
        source: entry.source ?? 'detected',
      });
    }
  }
  return cached.matcher;
}

export function spansOf(text, re) {
  const spans = [];
  for (const m of text.matchAll(new RegExp(re.source, 'g')))
    spans.push([m.index, m.index + m[0].length]);
  return spans;
}

// A private-use character absent from `text`, used to stand in for named-form
// markers during detection.
export function fillerFor(text) {
  for (let code = 0xe000; code <= 0xf8ff; code += 1) {
    const ch = String.fromCharCode(code);
    if (!text.includes(ch)) return ch;
  }
  return null;
}

// The longest part of a finding that does not cover filler characters.
export function trimFinding(finding, text, filler) {
  const raw = text.slice(finding.start, finding.end);
  if (!raw.includes(filler)) return finding;
  let best = null;
  let offset = 0;
  for (const piece of raw.split(filler)) {
    if (piece && (!best || piece.length > best.length))
      best = { start: finding.start + offset, length: piece.length };
    offset += piece.length + 1;
  }
  if (!best) return null;
  return {
    ...finding,
    start: best.start,
    end: best.start + best.length,
    length: best.length,
  };
}

// Known and live vault values (or their encodings) that occur in `text`, one
// per distinct value, without changing the vault.
export function exactValueHits(text, { vault, known = [] } = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const distinct = new Map();
  for (const { candidate } of exactMatcher(vault, known).find(
    text,
    spansOf(text, TOKEN_RE),
  )) {
    if (!distinct.has(candidate.value))
      distinct.set(candidate.value, candidate);
  }
  return [...distinct.values()];
}

// Replace known secrets and live vault values (and their encodings) first,
// then detector findings. `findingSource` is the vault source recorded for new
// detector findings ('prompt' for text the user typed).
function registerFinding(vault, type, value, source) {
  const matchScope = exactFromVault({ type, value, source })
    ? 'bare'
    : 'in-context';
  return vault.tokenFor(type, value, source, { matchScope });
}

export function scrub(
  text,
  {
    vault,
    known = [],
    profile = 'tool',
    channel = 'prose',
    context = 'mixed',
    detectFindings = detectSensitiveData,
    unmaskedTypes = [],
    findingSource = 'detected',
    // Values already counted as shown (scrubDeep shares one across strings).
    revealedSeen = new Set(),
  } = {},
) {
  if (typeof text !== 'string' || text.length === 0)
    return { text, replacements: [], revealed: [] };
  const replacements = [];
  const revealed = [];
  const unmasked = new Set(unmaskedTypes);
  // A value shown under an unmask grant counts once however often it
  // appears, and once when both the vault and the detector find it (H5).
  const reveal = (type, value) => {
    const key = `${baseType(type)}\u0000${value}`;
    if (revealedSeen.has(key)) return;
    revealedSeen.add(key);
    revealed.push({ type, count: 1 });
  };

  // Named-form markers (⟦TYPE-xxxxxx⟧) are kept as written. Detection runs on
  // the whole text with each marker replaced by filler of the same length, so a
  // marker never separates a value from the key name before it.
  const markers = [...text.matchAll(NAMED_TOKEN_RE)].map((m) => m[0]);
  const filler = markers.length ? fillerFor(text) : null;
  let out = filler
    ? text.replace(NAMED_TOKEN_RE, (m) => filler.repeat(m.length))
    : text;

  const blocked = [
    ...spansOf(out, TOKEN_RE),
    ...(filler ? spansOf(out, new RegExp(`${escapeRe(filler)}+`)) : []),
  ].sort((a, b) => a[0] - b[0]);
  const hits = exactMatcher(vault, known).find(out, blocked);
  if (hits.length) {
    const byToken = new Map();
    let rebuilt = '';
    let cursor = 0;
    for (const { start, end, candidate: c } of hits) {
      rebuilt += out.slice(cursor, start);
      cursor = end;
      if (unmasked.has(baseType(c.type))) {
        rebuilt += out.slice(start, end);
        reveal(c.type, out.slice(start, end));
        continue;
      }
      const token = vault.tokenFor(c.type, c.value, c.source);
      // A read-only view of the values on disk (packages/zeroh-disclosure-core/restorable.js) has no
      // token for a new value: it passes as it is (rule 8).
      if (!token) {
        rebuilt += out.slice(start, end);
        continue;
      }
      rebuilt += token;
      const seen = byToken.get(token);
      if (seen) seen.count += 1;
      else {
        const replacement = { token, type: c.type, source: c.source, count: 1 };
        byToken.set(token, replacement);
        replacements.push(replacement);
      }
    }
    out = rebuilt + out.slice(cursor);
  }

  const findings = detectFindings(out, { profile, channel, context })
    .map((f) => (filler ? trimFinding(f, out, filler) : f))
    .filter(Boolean);
  if (findings.length) {
    let rebuilt = '';
    let cursor = 0;
    for (const f of findings) {
      if (f.start < cursor) continue;
      const raw = out.slice(f.start, f.end);
      if ((f.protectionTypes ?? [f.type]).every((type) => unmasked.has(type))) {
        rebuilt += out.slice(cursor, f.end);
        cursor = f.end;
        reveal(f.type, raw);
        continue;
      }
      const token = registerFinding(vault, f.type, raw, findingSource);
      if (!token) {
        rebuilt += out.slice(cursor, f.end);
        cursor = f.end;
        continue;
      }
      rebuilt += out.slice(cursor, f.start) + token;
      cursor = f.end;
      replacements.push({
        token,
        type: f.type,
        source: findingSource,
        count: 1,
      });
    }
    out = rebuilt + out.slice(cursor);
  }

  if (filler) {
    let next = 0;
    out = out.replace(new RegExp(`${escapeRe(filler)}+`, 'g'), (run) => {
      let restored = '';
      while (restored.length < run.length && next < markers.length)
        restored += markers[next++];
      return restored;
    });
  }
  return { text: out, replacements, revealed };
}

// Walk any JSON value and scrub every string, keeping the shape.
export function scrubDeep(value, opts, acc = [], revealedAcc = []) {
  if (!opts?.revealedSeen) opts = { ...opts, revealedSeen: new Set() };
  if (typeof value === 'string') {
    const r = scrub(value, opts);
    acc.push(...r.replacements);
    revealedAcc.push(...r.revealed);
    return r.text;
  }
  if (Array.isArray(value))
    return value.map((v) => scrubDeep(v, opts, acc, revealedAcc));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value))
      out[k] = scrubDeep(v, opts, acc, revealedAcc);
    return out;
  }
  return value;
}

export function restore(text, vault, skip = null) {
  if (typeof text !== 'string') return { text, restored: [] };
  const restored = [];
  const out = text.replace(new RegExp(TOKEN_RE.source, 'g'), (token) => {
    if (skip?.has(token)) return token;
    const entry = vault.entryOf(token);
    if (!entry) return token;
    restored.push({ token, type: entry.type, source: entry.source });
    return entry.value;
  });
  return { text: out, restored };
}

// Tokens in any string of a JSON value that this vault once held and has since
// expired (value-free tombstones). Tokens the vault never held are not listed.
export function expiredTokens(value, vault, acc = new Set()) {
  if (typeof value === 'string') {
    for (const [token] of value.matchAll(new RegExp(TOKEN_RE.source, 'g'))) {
      if (vault.tombstoneOf?.(token)) acc.add(token);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) expiredTokens(item, vault, acc);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) expiredTokens(item, vault, acc);
  }
  return [...acc];
}

// `skip` holds tokens to leave as they are (tokens PreToolUse itself just put
// into the input for raw values the model wrote).
export function restoreDeep(value, vault, acc = [], skip = null) {
  if (typeof value === 'string') {
    const r = restore(value, vault, skip);
    acc.push(...r.restored);
    return r.text;
  }
  if (Array.isArray(value))
    return value.map((v) => restoreDeep(v, vault, acc, skip));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value))
      out[k] = restoreDeep(v, vault, acc, skip);
    return out;
  }
  return value;
}

// ---- destinations ------------------------------------------------------------

// Built-in destinations by the value's provider prefix. User-signed project
// rules extend them, keyed by variable name, token or type.
