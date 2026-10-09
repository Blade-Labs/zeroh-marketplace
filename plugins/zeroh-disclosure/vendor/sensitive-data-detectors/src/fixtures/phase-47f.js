// Deterministic synthetic values only. Labels, never values, go in probe logs.
import { createHash } from 'node:crypto';

function fakeAlphanumeric(length) {
  let value = 'ZEROHFAKE';
  for (let i = 0; value.length < length; i++)
    value += createHash('sha256')
      .update(`ZEROHFAKE-phase-47f-${i}`)
      .digest('base64')
      .replace(/[^A-Za-z0-9]/gu, '');
  return value.slice(0, length);
}

export const DOCUMENTATION_PLACEHOLDERS = [
  '<api-key>',
  '<pass>',
  '<password>',
  '<your token>',
  '<API_KEY>',
  '<your-api-key>',
  '<TOKEN>',
  '<x>',
  '<token_2>',
  '<api.key>',
  '<Name 47>',
  '<YOUR_API_KEY_HERE>',
  '<token1>',
];

const random32 = fakeAlphanumeric(32);
// Reviewer-supplied synthetic counterexamples to the former entropy heuristic.
// Keep labels separate so hook reports never print password-shaped values.
export const VOCABULARY_SECRET_CASES = [
  ['lowercase random word', '<xkqvbzmwtpj>'],
  ['uppercase random word', '<XKQVBZMWTP>'],
  ['capitalized random word', '<Xkqvbzmwtp>'],
  ['capitalized random with digits', '<Nzqrpwhv42>'],
  ['dotted random words', '<qzx.vbn.mlk>'],
  ['spaced random words', '<Kj Xq Zp Wm Rt>'],
  ['password with attached digit', '<Password1>'],
  ['season with digits', '<Summer24>'],
  ['login phrase with digits', '<Letmein99>'],
  ['common password with digit', '<hunter2>'],
  ['joined passphrase words', '<correcthorsebatterystaple>'],
  ['spaced passphrase words', '<correct horse battery staple>'],
  ['hyphenated season words', '<Spring-Summer-Autumn>'],
  ['ordinary sentence', '<the cat sat on the mat at noon>'],
];

export const ANGLE_SECRET_CASES = [
  ['alphanumeric 9', '<ZeR0hF4k9>'],
  ['alphanumeric 32', `<${random32}>`],
  ['alphanumeric 300', `<${fakeAlphanumeric(300)}>`],
  [
    'hex 40',
    `<${createHash('sha1').update('ZEROHFAKE-phase-47f').digest('hex')}>`,
  ],
  ['dotted random', `<${random32.slice(0, 16)}.${random32.slice(16)}>`],
  ['spaced random', `<${random32.slice(0, 16)} ${random32.slice(16)}>`],
  ...VOCABULARY_SECRET_CASES,
];

export const ANGLE_VALUE_SHAPES = [
  ['URL password', (v) => `curl "https://user:${v}@example.com"`],
  ['unquoted credential', (v) => `curl -u user:${v} https://example.com`],
  ['quoted credential', (v) => `curl -u "user:${v}" https://example.com`],
  ['assignment', (v) => `password=${v}`],
  ['quoted assignment', (v) => `password="${v}"`],
  ['inline env', (v) => `API_KEY="${v}" curl https://example.com`],
  ['JSON', (v) => JSON.stringify({ password: v })],
];

// Ruling 9 deliberately permits vocabulary-shaped passwords in only the
// base's URL and wholly unquoted credential forms.
export const RULING_9_CASES = [
  ...ANGLE_SECRET_CASES,
  ...DOCUMENTATION_PLACEHOLDERS.map((value, index) => [
    `documentation ${index}`,
    value,
  ]),
  ['possessive secret key', '<my-secret-key>'],
  ['change instruction', '<changeme>'],
  ['password label', '<the-password>'],
  ['database password label', '<Database Password 24>'],
  ['token instruction', '<your_token_here>'],
];
