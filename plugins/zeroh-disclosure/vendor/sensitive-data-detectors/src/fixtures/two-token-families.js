// Shared acceptance fixture, copied with src/ by sync-detectors.mjs.
// Gateway suffixes deliberately overlap common numeric detector shapes.
export const TWO_TOKEN_FAMILIES = Object.freeze({
  gateway: Object.freeze([
    `<EMAIL_${'a'.repeat(16)}>`,
    '<API_KEY_1234567890123456>',
    `<PHONE_${'5551234567'.padEnd(16, '0')}>`,
  ]),
  zeroh: Object.freeze(['[EMAIL-abcdef]', '[API_KEY-abcdef]']),
  raw: Object.freeze([
    'ZEROHFAKE.person@example.com',
    'sk_live_ZEROHFAKE0000000000000000',
  ]),
});
export const MIXED_TOKEN_REQUEST = [
  ...TWO_TOKEN_FAMILIES.gateway,
  ...TWO_TOKEN_FAMILIES.zeroh,
  ...TWO_TOKEN_FAMILIES.raw,
].join(' ');
