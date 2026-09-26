// SPDX-License-Identifier: AGPL-3.0-only

// Personal data the free plugin detects. The decisions come from vendored,
// maintained libraries; ZeroH's own code only proposes candidates and keeps
// code and logs readable:
//   - validator.js (vendor/validator): isEmail, isCreditCard, isIBAN,
//     isIdentityCard and isTaxID decide whether a candidate is valid;
//   - the IANA root-zone list (vendor/iana) checks an address's top-level
//     domain, which isEmail only checks for shape;
//   - libphonenumber-js (vendor/libphonenumber-js) finds phone numbers with
//     its own text matcher (./phone.js).
// The candidate finders below are deliberately broad shapes (an `@` with the
// characters around it, printed card and IBAN layouts, the shapes of the
// national IDs); a candidate that its validator rejects is left as text.
// The national-ID kinds use the entity names of Microsoft Presidio's
// recognizers (ES_NIF, ES_NIE, IT_FISCAL_CODE, FI_PERSONAL_IDENTITY_CODE).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { domainToASCII, fileURLToPath } from 'node:url';
import {
  findPhoneNumbers,
  LIBPHONENUMBER_VERSION,
  phoneRegion,
} from './phone.js';
import { findCryptoAddresses } from './crypto.js';
import { findIpAddresses } from './ip.js';
import { findIds, ID_RULES } from './national-ids.js';

const require = createRequire(import.meta.url);
function validator(name) {
  const mod = require(`../../vendor/validator/lib/${name}.js`);
  return mod.default ?? mod;
}
const isEmail = validator('isEmail');
const isCreditCard = validator('isCreditCard');
const isIBAN = validator('isIBAN');
const isIdentityCard = validator('isIdentityCard');
const isTaxID = validator('isTaxID');

export const VALIDATOR_VERSION = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../vendor/validator/SOURCE.json', import.meta.url),
    ),
    'utf8',
  ),
).version;

const TLD_CATALOG = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../rules/tlds.generated.json', import.meta.url)),
    'utf8',
  ),
);
const TLDS = new Set(TLD_CATALOG.tlds);
export const TLD_VERSION = TLD_CATALOG.version;

// ---- email ---------------------------------------------------------------------

// isEmail options: UTF-8 local parts (RFC 6531), quoted local parts (always
// on in validator), IP-literal domains, and a required top-level domain.
// isEmail fills in its defaults on the object it is given, so each call gets
// a copy.
const EMAIL_OPTIONS = Object.freeze({
  allow_utf8_local_part: true,
  allow_ip_domain: true,
  require_tld: true,
});

// The RFC 2606 documentation names are accepted like real top-level domains,
// so `name@example.com` and `name@host.example` behave the same.
const DOCUMENTATION_TLDS = new Set(['example', 'test', 'invalid']);

export function knownTopLevelDomain(domain) {
  const tld = String(domain).split('.').at(-1).toLowerCase();
  const ascii = /^[a-z0-9-]+$/u.test(tld) ? tld : domainToASCII(tld);
  return Boolean(ascii) && (TLDS.has(ascii) || DOCUMENTATION_TLDS.has(ascii));
}

// Characters a candidate's local part may run over (letters and digits in
// any script, and `. _ % + - '`). The rarer atext symbols (`= / ! # $ & * ? ^
// { | } ~`) are left out, so `email=bob@example.com` yields `bob@…`, not
// `email=bob@…`. A quoted local part is taken as a whole.
const LOCAL_CHAR = /[\p{L}\p{N}\p{M}._%+'-]/u;
const LOCAL_EDGE = /[\p{L}\p{N}\p{M}_]/u;
const DOMAIN_CHAR = /[\p{L}\p{N}\p{M}_.-]/u;

function emailCandidate(text, at) {
  let start = at;
  if (text[at - 1] === '"') {
    const open = text.lastIndexOf('"', at - 2);
    if (open < 0 || text.slice(open, at).includes('\n')) return null;
    start = open;
  } else {
    while (start > 0 && LOCAL_CHAR.test(text[start - 1])) start -= 1;
    while (start < at && !LOCAL_EDGE.test(text[start])) start += 1;
  }
  let end = at + 1;
  if (text[end] === '[') {
    const close = text.indexOf(']', end);
    if (close < 0 || close - end > 60) return null;
    end = close + 1;
  } else {
    while (end < text.length && DOMAIN_CHAR.test(text[end])) end += 1;
    while (end > at + 1 && /[.-]/u.test(text[end - 1])) end -= 1;
  }
  if (start >= at || end <= at + 1) return null;
  return { start, end };
}

function findEmails(text) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('@', from);
    if (at < 0) break;
    from = at + 1;
    const c = emailCandidate(text, at);
    if (!c || (out.length && c.start < out.at(-1).end)) continue;
    const value = text.slice(c.start, c.end);
    const domain = value.slice(value.lastIndexOf('@') + 1);
    if (!isEmail(value, { ...EMAIL_OPTIONS })) continue;
    if (!domain.startsWith('[') && !knownTopLevelDomain(domain)) continue;
    out.push(c);
  }
  return out;
}

// ---- cards, IBANs, national IDs --------------------------------------------------

const NOT_BEFORE = '(?<![\\p{L}\\p{N}_.\\-])';
const NOT_AFTER = '(?![\\p{L}\\p{N}_\\-]|[.,]\\d)';

// Printed card layouts: 4-4-4-4(+3), 4-6-5 (Amex) or one run of 13-19 digits.
const CARD_CANDIDATE = new RegExp(
  `${NOT_BEFORE}(?:\\d{4}([ -])\\d{4}\\1\\d{4}\\1\\d{1,7}|\\d{4}([ -])\\d{6}\\2\\d{4,5}|\\d{13,19})${NOT_AFTER}`,
  'gu',
);

// A country code, check digits and groups of four, compact or spaced; the
// candidate is tried with fewer trailing groups when the whole fails
// ("DE89 3704 0044 0532 0130 00 2 days" → the IBAN without " 2").
const IBAN_CANDIDATE =
  /(?<![A-Z0-9])[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){2,7}(?:[ -]?[A-Z0-9]{1,3})?(?![A-Z0-9])/gu;

function findIbans(text) {
  const out = [];
  for (const m of text.matchAll(IBAN_CANDIDATE)) {
    const ends = [m[0].length];
    for (const g of m[0].matchAll(/[ -]/gu)) ends.push(g.index);
    ends.sort((a, b) => b - a);
    for (const end of ends) {
      const value = m[0].slice(0, end);
      if (value.replace(/[ -]/gu, '').length < 15) break;
      if (isIBAN(value)) {
        out.push({ start: m.index, end: m.index + end });
        break;
      }
    }
  }
  return out;
}

function shapes(pattern, accept) {
  const re = new RegExp(pattern, 'gu');
  return (text) => {
    const out = [];
    for (const m of text.matchAll(re))
      if (accept(m[0]))
        out.push({ start: m.index, end: m.index + m[0].length });
    return out;
  };
}

const WORD_BEFORE = '(?<![\\p{L}\\p{N}_])';
const WORD_AFTER = '(?![\\p{L}\\p{N}_])';

// ---- context guards ----------------------------------------------------------------

// `git@github.com:org/repo`, `ssh://deploy@host/…`, `deploy@host:/srv`: an
// SSH login, not a mailbox.
function sshAddress(input, start, end) {
  const value = input.slice(start, end);
  const before = input.slice(Math.max(0, start - 3), start);
  const after = input[end] ?? '';
  const next = input[end + 1] ?? '';
  return (
    /^git@/iu.test(value) ||
    before === '://' ||
    (after === ':' && next !== '' && !/\s/u.test(next))
  );
}

// Addresses that belong to no person: GitHub's noreply addresses and the
// no-reply senders in commit trailers and notifications.
function serviceAddress(value) {
  return (
    /@users\.noreply\.github\.com$/iu.test(value) ||
    /^(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon)@/iu.test(value)
  );
}

// Digits that sit inside a UUID (`00000000-0000-0000-0000-000000000000`).
function insideUuid(input, start, end) {
  const around = input.slice(Math.max(0, start - 36), end + 36);
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(
    around,
  );
}

// A number whose `+` is the marker of an added line in a unified diff.
function diffMarker(input, start) {
  const lineStart = input.lastIndexOf('\n', start - 1) + 1;
  return (
    lineStart === start &&
    input[start] === '+' &&
    /^(?:diff --git |@@ |\+\+\+ |--- )/mu.test(input)
  );
}

// A number right after a reference word ("order 20250925001", "invoice
// #123-456-7890", "PR 4242") is a reference, not a phone number.
const REFERENCE_BEFORE =
  /\b(?:order|invoice|inv|ticket|booking|tracking|reference|ref|receipt|issue|pr|pull request|build|run|job|version|release|po|account|acct|customer|member|serial|sku|transaction|tx|trace|request)\s*(?:no\.?|number|num|id)?\s*[:#-]?\s*#?\s*$/iu;

function afterReferenceWord(input, start) {
  return REFERENCE_BEFORE.test(input.slice(Math.max(0, start - 24), start));
}

// Buffer sizes and screen resolutions: every group a power of two or a
// common display dimension (`2048 4096 8192`, `1920 1080`).
const DIMENSIONS = new Set([
  240, 320, 360, 480, 540, 576, 600, 640, 720, 768, 800, 900, 960, 1050, 1080,
  1200, 1280, 1366, 1440, 1536, 1600, 1680, 1920, 2160, 2560, 2880, 3200, 3840,
  4320, 5120, 7680,
]);
function looksLikeNumberList(value) {
  const groups = String(value)
    .replace(/^\+/u, '')
    .split(/[\s.()x×-]+/u)
    .filter(Boolean);
  if (groups.length < 2) return false;
  return groups.every((g) => {
    const n = Number(g);
    return (
      /^\d+$/u.test(g) &&
      !/^0/u.test(g) &&
      (DIMENSIONS.has(n) || (n >= 16 && (n & (n - 1)) === 0))
    );
  });
}

// A number written with thousands separators (`30 000 000`, `1.250.000`).
function looksLikeGroupedNumber(value) {
  const m = /^(\d{1,3})(?:[  .,]\d{3})+$/u.exec(String(value));
  return Boolean(m) && (m[1].length <= 2 || /(?:^|\D)000(?:\D|$)/u.test(value));
}

// A calendar date written with separators (`2026-09-25`, `25.09.2026`).
function looksLikeDate(value) {
  return (
    /^\d{4}[-./ ]\d{1,2}[-./ ]\d{1,2}$/u.test(value) ||
    /^\d{1,2}[-./ ]\d{1,2}[-./ ]\d{4}$/u.test(value)
  );
}

// `a+16777216` is arithmetic, `v2+1234567890` a build tag, digits right
// after `4.30.` or `12:` continue a version or a time, and `iso-8859-15` or
// `aix-6107-1415-32` are names.
function afterWordCharacter(input, start) {
  return /(?:[\p{L}\p{N}_)\]]|\d[.:,/]|[\p{L}\p{N}]-)$/u.test(
    input.slice(Math.max(0, start - 2), start),
  );
}

// A range of years (`2012-2015`, `1999 2024`).
function looksLikeYearRange(value) {
  return /^(?:19|20)\d\d[ -](?:19|20)\d\d$/u.test(value);
}

const TYPED_NATIONAL = /^(?:\(\d{1,5}\) ?|\d+[ -])+\d+$/u;

// ---- rules -----------------------------------------------------------------------

// What the free plugin detects: the token type, risk, the vendored source that
// decides, and the context guard each needs in code and logs. docs/detection.md
// lists them and the measurements behind this list.
export const PII_RULES = [
  {
    type: 'EMAIL',
    name: 'email address',
    label: 'email addresses',
    risk: 'medium',
    confidence: 0.9,
    source: 'validator.isEmail + IANA TLDs',
    find: findEmails,
    guard: (input, start, end) =>
      sshAddress(input, start, end) || serviceAddress(input.slice(start, end)),
  },
  {
    type: 'CARD_NUMBER',
    name: 'card number',
    label: 'card numbers (issuer range and Luhn)',
    risk: 'high',
    confidence: 0.9,
    source: 'validator.isCreditCard',
    find: (text) => {
      const out = [];
      for (const m of text.matchAll(CARD_CANDIDATE))
        if (isCreditCard(m[0]))
          out.push({ start: m.index, end: m.index + m[0].length });
      return out;
    },
    guard: insideUuid,
  },
  {
    type: 'IBAN',
    name: 'IBAN',
    label: 'IBANs (country format and checksum)',
    risk: 'high',
    confidence: 0.95,
    source: 'validator.isIBAN',
    find: findIbans,
  },
  {
    // DNI (8 digits + control letter).
    type: 'ES_NIF',
    name: 'Spanish DNI number',
    label: 'Spanish DNI numbers',
    risk: 'high',
    confidence: 0.9,
    source: "validator.isIdentityCard('ES')",
    find: shapes(`${WORD_BEFORE}\\d{8}[A-Z]${WORD_AFTER}`, (v) =>
      isIdentityCard(v, 'ES'),
    ),
  },
  {
    // NIE (X/Y/Z + 7 digits + control letter).
    type: 'ES_NIE',
    name: 'Spanish NIE number',
    label: 'Spanish NIE numbers',
    risk: 'high',
    confidence: 0.9,
    source: "validator.isIdentityCard('ES')",
    find: shapes(`${WORD_BEFORE}[XYZ]\\d{7}[A-Z]${WORD_AFTER}`, (v) =>
      isIdentityCard(v, 'ES'),
    ),
  },
  {
    // Codice fiscale (16 characters + control letter).
    type: 'IT_FISCAL_CODE',
    name: 'Italian fiscal code',
    label: 'Italian fiscal codes',
    risk: 'high',
    confidence: 0.9,
    source: "validator.isTaxID('it-IT')",
    find: shapes(
      `${WORD_BEFORE}[A-Z]{6}[0-9L-NP-V]{2}[A-EHLMPR-T][0-9L-NP-V]{2}[A-Z][0-9L-NP-V]{3}[A-Z]${WORD_AFTER}`,
      (v) => isTaxID(v, 'it-IT'),
    ),
  },
  {
    // Henkilötunnus (DDMMYY, century sign, 3 digits, control character).
    type: 'FI_PERSONAL_IDENTITY_CODE',
    name: 'Finnish personal identity code',
    label: 'Finnish personal identity codes',
    risk: 'high',
    confidence: 0.9,
    source: "validator.isIdentityCard('FI')",
    find: shapes(`${WORD_BEFORE}\\d{6}[-+A]\\d{3}[0-9A-Y]${WORD_AFTER}`, (v) =>
      isIdentityCard(v, 'FI'),
    ),
  },
  {
    type: 'PHONE_NUMBER',
    name: 'phone number',
    label: 'phone numbers',
    risk: 'medium',
    confidence: 0.85,
    source: 'libphonenumber-js',
    find: (text, { phoneRegion: region }) =>
      findPhoneNumbers(text, { region }).filter(
        // A national number is kept only when written the way people type
        // one: groups of digits (an area code may be in parentheses) joined
        // by single spaces or hyphens. A bare digit run, or one with dots,
        // commas or slashes, is more often an id, a constant or a list.
        (p) =>
          p.international || TYPED_NATIONAL.test(text.slice(p.start, p.end)),
      ),
    guard: (input, start, end) => {
      const value = input.slice(start, end);
      return (
        afterWordCharacter(input, start) ||
        diffMarker(input, start) ||
        afterReferenceWord(input, start) ||
        looksLikeNumberList(value) ||
        looksLikeGroupedNumber(value) ||
        looksLikeDate(value) ||
        looksLikeYearRange(value)
      );
    },
  },
  {
    type: 'IP_ADDRESS',
    name: 'IP address',
    label: 'IP addresses',
    risk: 'medium',
    confidence: 0.8,
    source: 'validator.isIP',
    find: findIpAddresses,
  },
  {
    type: 'CRYPTO',
    name: 'cryptocurrency wallet address',
    label: 'Bitcoin and Ethereum addresses',
    risk: 'medium',
    confidence: 0.8,
    source: 'validator.isBtcAddress, validator.isEthereumAddress',
    find: (text, { profile }) => findCryptoAddresses(text, { profile }),
  },
  ...ID_RULES.map((rule) => ({
    type: rule.type,
    name: rule.name,
    label: rule.label,
    risk: 'high',
    confidence: 0.9,
    source: rule.source,
    find: (text) => findIds(rule, text),
  })),
];

// Every kind above with its name and plural label, for the policy, messages
// and the catalog.
export const PERSONAL_DATA_KINDS = Object.freeze(
  PII_RULES.map(({ type, name, label, source }) =>
    Object.freeze({ type, name, label, source }),
  ),
);

export { LIBPHONENUMBER_VERSION, phoneRegion };

// Findings for one rule on `text`.
export function findPersonalData(
  rule,
  text,
  { phoneRegion: region, profile = 'prompt' } = {},
) {
  const out = [];
  for (const hit of rule.find(text, { phoneRegion: region, profile })) {
    if (rule.guard?.(text, hit.start, hit.end)) continue;
    out.push({ start: hit.start, end: hit.end, confidence: rule.confidence });
  }
  return out;
}
