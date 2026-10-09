// Recognition only: never mint or resolve the gateway's placeholders.
// Derived from privacy-gateway-core/src/services/token-derivation.service.ts:
// Known entity/credential types only; sanitizeLabel's alphabet alone can
// contain a real value. privacy-gateway-postgres/src/stores.ts emits
// lowercase SHA-256 hex suffixes of exactly 16, 32 or 64 characters.
export const GATEWAY_TOKEN_PATTERN_VERSION = 2;
// Gateway taxonomy names plus the local detector's documented type aliases.
// Custom schema labels are data until they are added to this vocabulary.
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
export const ZEROH_TOKEN_PATTERN = String.raw`\[[A-Z_]+-[0-9a-f]{6}\]`;
export const MASKED_TOKEN_PATTERN = `(?:${ZEROH_TOKEN_PATTERN}|${GATEWAY_TOKEN_PATTERN})`;

export function maskedTokenSpans(text) {
  return [...String(text).matchAll(new RegExp(MASKED_TOKEN_PATTERN, 'g'))].map(
    (match) => [match.index, match.index + match[0].length],
  );
}

export function isGatewayToken(value) {
  return new RegExp(`^${GATEWAY_TOKEN_PATTERN}$`).test(String(value));
}

// For shell tokenizers: read one opaque placeholder without consuming syntax
// before or after it. Source offsets and the command itself stay unchanged.
export function gatewayTokenAt(text, index) {
  if (text[index] !== '<') return null;
  return (
    new RegExp(`^${GATEWAY_TOKEN_PATTERN}`).exec(text.slice(index))?.[0] ?? null
  );
}
