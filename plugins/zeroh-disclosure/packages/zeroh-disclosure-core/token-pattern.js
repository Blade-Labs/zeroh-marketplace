// SPDX-License-Identifier: AGPL-3.0-only

// Load-time recognition must use no imports: the loader reads block mode even
// when the detector vendor tree is absent. Tests pin these constants to it.
export const GATEWAY_TOKEN_PATTERN_VERSION = 2;
export const GATEWAY_TOKEN_LABELS = Object.freeze([
  'PERSON',
  'NAME',
  'EMAIL',
  'EMAIL_ADDRESS',
  'PHONE',
  'PHONE_NUMBER',
  'CREDIT_CARD',
  'CARD_NUMBER',
  'DOB',
  'IBAN',
  'IBAN_CODE',
  'US_BANK_NUMBER',
  'CRYPTO',
  'IP_ADDRESS',
  'MAC_ADDRESS',
  'LOCATION',
  'ADDRESS',
  'PASSPORT',
  'US_PASSPORT',
  'US_DRIVER_LICENSE',
  'US_ITIN',
  'US_SSN',
  'QATAR_ID',
  'SAUDI_NID',
  'IQAMA',
  'EMIRATES_ID',
  'UK_NHS',
  'MEDICAL_LICENSE',
  'UK_NINO',
  'IN_AADHAAR',
  'IN_PAN',
  'PK_CNIC',
  'BR_CPF',
  'PL_PESEL',
  'SE_PERSONNUMMER',
  'NL_BSN',
  'CN_RESIDENT_ID',
  'TW_NATIONAL_ID',
  'HK_IDENTITY_CARD',
  'NO_FODSELSNUMMER',
  'TH_TNIN',
  'IL_ID',
  'MALAYSIA_NRIC',
  'ES_NIF',
  'ES_DNI',
  'ES_NIE',
  'IT_FISCAL_CODE',
  'FI_PERSONAL_IDENTITY_CODE',
  'API_KEY',
  'PASSWORD',
  'TOKEN',
  'PRIVATE_KEY',
  'SECRET',
  'ACCESS_KEY',
  'CREDENTIAL',
  'AUTHORIZATION',
]);
export const GATEWAY_TOKEN_PATTERN = String.raw`<(?:${GATEWAY_TOKEN_LABELS.join('|')})_(?:[0-9a-f]{16}|[0-9a-f]{32}|[0-9a-f]{64})>`;
export function isGatewayToken(value) {
  return new RegExp(`^${GATEWAY_TOKEN_PATTERN}$`).test(String(value));
}
export function gatewayTokenAt(text, index) {
  if (text[index] !== '<') return null;
  return (
    new RegExp(`^${GATEWAY_TOKEN_PATTERN}`).exec(text.slice(index))?.[0] ?? null
  );
}
export const MASKED_TOKEN_RE = new RegExp(
  `(?:\\[[A-Z_]+-[0-9a-f]{6}\\]|${GATEWAY_TOKEN_PATTERN})`,
  'g',
);
export const TOKEN_SPEC_V2 = Object.freeze({
  version: 'zeroh-disclosure-token-spec/2',
  zeroh: Object.freeze({ family: 'zeroh-1.x', ['pattern_version']: 1 }),
  gateway: Object.freeze({
    family: 'privacy-gateway',
    ['pattern_version']: GATEWAY_TOKEN_PATTERN_VERSION,
  }),
});

// Future recognition epochs add a registry entry; signed historical specs stay.
export const TOKEN_SPEC_V1 = Object.freeze({
  ...TOKEN_SPEC_V2,
  version: 'zeroh-disclosure-token-spec/1',
  gateway: Object.freeze({ family: 'privacy-gateway', ['pattern_version']: 1 }),
});
export const TOKEN_SPEC_VERSION = TOKEN_SPEC_V2;
export const TOKEN_SPECS = Object.freeze({
  [TOKEN_SPEC_V1.version]: TOKEN_SPEC_V1,
  [TOKEN_SPEC_V2.version]: TOKEN_SPEC_V2,
});

// The one token form: [TYPE-xxxxxx], and ⟦TYPE-xxxxxx⟧ when the model names a
// token itself. These restore/display patterns deliberately exclude the gateway.
export const TOKEN_PATTERN = String.raw`\[[A-Z_]+-[0-9a-f]{6}\]`;

// Global: for match, matchAll and replace (never for a stateful .test).
export const TOKEN_RE = new RegExp(TOKEN_PATTERN, 'g');
export const NAMED_TOKEN_RE = /⟦[A-Z_]+-[0-9a-f]{6}⟧/gu;

const WHOLE_TOKEN_RE = new RegExp(`^${TOKEN_PATTERN}$`);
const ANY_TOKEN_RE = new RegExp(TOKEN_PATTERN);

export function isToken(value) {
  return WHOLE_TOKEN_RE.test(String(value));
}

export function containsToken(text) {
  return ANY_TOKEN_RE.test(String(text));
}

// One line for the model on a turn that brings tokens (UserPromptSubmit,
// PostToolUse): the display rules cannot tell what the model means, so the
// model has to say it with the form it writes.
export const NAMING_REMINDER = 'naming-reminder';
export function namingReminder(token) {
  const plain = token ? String(token) : '[API_KEY-3f9a1c]';
  const named = `⟦${plain.slice(1, -1)}⟧`;
  return `The user's screen replaces every plain ${plain} you write with the real value. When you mean the token itself (which token you saw, that a value is masked), write ${named}, e.g. "I saw ${named}". When you mean the value (answers, commands, code), write ${plain}.`;
}

// Safety net for the one unambiguous case: the word token or placeholder right
// next to a plain token ("the token [API_KEY-3f9a1c]", "[API_KEY-3f9a1c] is a
// placeholder"). Only the keywords ignore case; the token itself stays
// case-sensitive, and a keyword inside a name (GITHUB_TOKEN) does not count.
const anyCase = (word) =>
  [...word].map((c) => `[${c.toUpperCase()}${c.toLowerCase()}]`).join('');
const KEYWORD = `(?:${anyCase('token')}|${anyCase('placeholder')})`;
const NOT_WORD_BEFORE = String.raw`(?<![\p{L}\p{N}_])`;
const NOT_WORD_AFTER = String.raw`(?![\p{L}\p{N}_])`;
const NAMING_BEFORE_RE = new RegExp(
  String.raw`(${NOT_WORD_BEFORE}${KEYWORD}\s+\x60?)(${TOKEN_PATTERN})`,
  'gu',
);
const NAMING_AFTER_RE = new RegExp(
  String.raw`(${TOKEN_PATTERN})(\x60?\s+(?:is|was)\s+(?:a|the|just a|only a)\s+${KEYWORD}${NOT_WORD_AFTER})`,
  'gu',
);
const toNamed = (token) => `⟦${token.slice(1, -1)}⟧`;

// Returns the text with those tokens in ⟦⟧ form, and whether anything changed.
export function nameMentionedTokens(text) {
  const input = String(text);
  const output = input
    .replace(NAMING_BEFORE_RE, (_m, lead, token) => `${lead}${toNamed(token)}`)
    .replace(NAMING_AFTER_RE, (_m, token, tail) => `${toNamed(token)}${tail}`);
  return { text: output, changed: output !== input };
}
