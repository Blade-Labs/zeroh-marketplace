// SPDX-License-Identifier: AGPL-3.0-only

// National ID and tax numbers. Each row names the published rule or vendored
// validator that decides; ZeroH adds only the candidate shape and, for a
// number that is nothing but 9 to 13 digits, a context word (./context.js)
// in the same line, key name or table column.
//
// Sources:
//   validator.js 13.15.35 (vendor/validator): isIdentityCard (ES, FI, IN, PK,
//     PL, NO, TH, he-IL, zh-CN, zh-TW, zh-HK) and isTaxID (it-IT, pt-BR,
//     sv-SE, nl-NL).
//   US SSN: SSA, "Social Security Number Randomization" and its FAQ
//     (https://www.ssa.gov/employer/randomization.html,
//     https://www.ssa.gov/employer/randomizationfaqs.html): area 000, 666
//     and 900-999, group 00 and serial 0000 are never assigned; SSA reserves
//     987-65-4320 to 987-65-4329 for advertising. Microsoft Presidio's
//     UsSsnRecognizer.invalidate_result (presidio-analyzer 2.2.364, MIT)
//     also rejects one repeated digit and 123-45-6789, 987-65-4320 and
//     078-05-1120; 219-09-9999 is the other SSN SSA voided after it was
//     printed in an advertisement.
//   US ITIN: IRS Publication 4757 (https://www.irs.gov/pub/irs-pdf/p4757.pdf):
//     9XX-XX-XXXX with the 4th and 5th digits in 50-65, 70-88, 90-92, 94-99.
//   UK NINO: HMRC National Insurance Manual NIM39110
//     (https://www.gov.uk/hmrc-internal-manuals/national-insurance-manual/nim39110):
//     D, F, I, Q, U, V never in the prefix, O never second, prefixes BG, GB,
//     KN, NK, NT, TN, ZZ unused, suffix A-D; PP999999P is not a NINO.
//   Qatar ID: 11 digits, the first 2 or 3 for the century of birth, two
//     digits of the birth year, the ISO 3166-1 numeric code of the
//     nationality and a 5-digit serial (https://qexpat.com/qatar-id-number-means/,
//     https://www.dohaguides.com/qatar-id-number/); the nationality code is
//     checked against vendor/i18n-iso-countries (ISO 3166-1).
//   Saudi national ID and iqama: vendor/saudi-id-validator (validateSAID,
//     alhazmy13/Saudi-ID-Validator, MIT): 10 digits, first 1 or 2, check digit.
//   Emirates ID: 784-YYYY-NNNNNNN-N (784 is the UAE's ISO 3166-1 numeric
//     code, YYYY the birth year); no check digit is published, so only the
//     dashed form, or the digits next to a context word, count.
//   Blade Labs ai-ui-chat, src/services/pii-detector.ts: Arabic-Indic digits
//     for Gulf IDs, the Arabic context words, the Malaysian NRIC date check,
//     passports (isPassportNumber GB/US/MY next to "passport") and dates of
//     birth (1900 to five years ago, next to dob/born/birthday).
//   Malaysian NRIC place-of-birth codes: JPN "Kod Negeri" and "Kod Negara"
//     (as listed in Wikipedia, "Malaysian identity card").
//   India PAN: five letters, four digits, a letter; the fourth letter is the
//     holder type (Presidio InPanRecognizer "PAN (High)", MIT).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { hasContext } from './context.js';

const require = createRequire(import.meta.url);
function validator(name) {
  const mod = require(`../../vendor/validator/lib/${name}.js`);
  return mod.default ?? mod;
}
const isIdentityCard = validator('isIdentityCard');
const isTaxID = validator('isTaxID');
const isPassportNumber = validator('isPassportNumber');

const vendorFile = (relative) =>
  readFileSync(
    fileURLToPath(new URL(`../../vendor/${relative}`, import.meta.url)),
    'utf8',
  );

// ISO 3166-1 numeric country codes.
const ISO_NUMERIC = new Set(
  JSON.parse(vendorFile('i18n-iso-countries/codes.json')).map((row) => row[2]),
);

// The unchanged upstream script defines one function and exports nothing;
// it runs in an empty context and its function is taken from there.
const validateSAID = vm.runInNewContext(
  `${vendorFile('saudi-id-validator/validateSAID.js')}\nvalidateSAID;`,
  {},
);

// ---- the published rules -----------------------------------------------------

const SSN_INVALID = new Set(['123456789', '078051120', '219099999']);

export function validSsn(value) {
  const digits = value.replace(/\D/gu, '');
  const area = digits.slice(0, 3);
  if (area === '000' || area === '666' || area[0] === '9') return false;
  if (digits.slice(3, 5) === '00' || digits.slice(5) === '0000') return false;
  if (/^(\d)\1{8}$/u.test(digits) || SSN_INVALID.has(digits)) return false;
  if (/^98765432\d$/u.test(digits)) return false;
  return true;
}

export function validItin(value) {
  const digits = value.replace(/\D/gu, '');
  const group = Number(digits.slice(3, 5));
  return (
    digits[0] === '9' &&
    !/^98765432\d$/u.test(digits) &&
    ((group >= 50 && group <= 65) ||
      (group >= 70 && group <= 88) ||
      (group >= 90 && group <= 92) ||
      (group >= 94 && group <= 99))
  );
}

export function validQatarId(value) {
  return /^[23]\d{10}$/u.test(value) && ISO_NUMERIC.has(value.slice(3, 6));
}

// ---- Malaysian NRIC and dates of birth -----------------------------------------

// Place-of-birth codes JPN assigns (Jabatan Pendaftaran Negara, "Kod Negeri"
// and "Kod Negara", as listed in Wikipedia's "Malaysian identity card"): the
// states 01-16 and 21-59, abroad 60-68, 71-72, 74-79 and 82-93, 98-99.
function validMalaysiaPlace(code) {
  const n = Number(code);
  return (
    (n >= 1 && n <= 16) ||
    (n >= 21 && n <= 68) ||
    n === 71 ||
    n === 72 ||
    (n >= 74 && n <= 79) ||
    (n >= 82 && n <= 93) ||
    n === 98 ||
    n === 99
  );
}

function realDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validMalaysiaNric(value) {
  const digits = value.replace(/-/gu, '');
  const [yy, mm, dd] = [0, 2, 4].map((i) => Number(digits.slice(i, i + 2)));
  return (
    (realDate(1900 + yy, mm, dd) || realDate(2000 + yy, mm, dd)) &&
    validMalaysiaPlace(digits.slice(6, 8))
  );
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

// A two-digit year is the latest one not after this year.
function fullYear(text, now) {
  if (text.length === 4) return Number(text);
  const yy = Number(text);
  const century = Math.floor(now / 100) * 100;
  return century + yy <= now ? century + yy : century - 100 + yy;
}

// A date of birth: a real calendar date from 1900 to five years ago, in the
// numeric (year first, or day and month either way round) or month-name
// forms ai-ui-chat's detector accepts.
export function validBirthDate(value, now = new Date().getUTCFullYear()) {
  const plausible = (y, m, d) => y >= 1900 && y <= now - 5 && realDate(y, m, d);
  const text = value
    .replace(/(\d)(?:st|nd|rd|th)/giu, '$1')
    .replace(/['.,]/gu, ' ');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(value);
  if (m) return plausible(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/u.exec(value);
  if (m) {
    const y = fullYear(m[3], now);
    return (
      plausible(y, Number(m[2]), Number(m[1])) ||
      plausible(y, Number(m[1]), Number(m[2]))
    );
  }
  const words = text.trim().split(/\s+/u);
  const monthOf = (w) => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1;
  if (words.length !== 3) return false;
  const [a, b, c] = words;
  const y = fullYear(c, now);
  if (monthOf(b) && /^\d+$/u.test(a))
    return plausible(y, monthOf(b), Number(a));
  if (monthOf(a) && /^\d+$/u.test(b))
    return plausible(y, monthOf(a), Number(b));
  return false;
}

// ---- candidate shapes ----------------------------------------------------------

// A digit, Western or Arabic-Indic (٠-٩): Gulf IDs are often written with
// the latter, and are normalised before they are checked.
const D = '[0-9٠-٩]';

export function toAsciiDigits(value) {
  return value.replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x660));
}

const B = '(?<![\\p{L}\\p{N}_.\\-/])';
const A = '(?![\\p{L}\\p{N}_\\-/]|\\.\\d)';

// Case-insensitive words, not inside a longer word.
function words(...alternatives) {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`,
    'iu',
  );
}
const SEP = '[\\s_.-]*';

const CONTEXT = {
  ssn: words(
    'ssns?',
    'ss#',
    'ssn#',
    `social${SEP}security(?:${SEP}(?:number|no))?`,
  ),
  itin: words('itins?', `individual${SEP}taxpayer`),
  // Includes ZeroH Enterprise's QatarIdRecognizer context words.
  qatar: words(
    'q\\.?i\\.?d',
    `qatar(?:i)?${SEP}ids?`,
    `national${SEP}ids?`,
    `id${SEP}(?:number|no)`,
    'رقم الهوية',
    'البطاقة الشخصية',
  ),
  aadhaar: words('aadhaa?r', 'uidai', 'आधार'),
  pan: words('pan', `permanent${SEP}account${SEP}(?:number|no)`),
  cnic: words('cnic', 'nadra', `national${SEP}ids?`),
  emirates: words(`emirates${SEP}ids?`, 'eid', 'رقم الهوية'),
  // ZeroH Enterprise's SaudiNationalIdRecognizer and IqamaRecognizer
  // context words, and the Arabic ones.
  saudiNid: words(
    'nid',
    `national${SEP}ids?`,
    'citizen',
    `saudi${SEP}(?:national${SEP})?ids?`,
    'هوية',
    'الهوية',
  ),
  iqama: words('iqama', 'residency', `resident${SEP}ids?`, 'إقامة', 'الإقامة'),
  nric: words(
    'nric',
    'mykad',
    `(?:ic|i/c)${SEP}(?:number|no)`,
    'kad pengenalan',
  ),
  passport: words('passports?', 'passeport', 'pasaport', 'جواز(?: السفر)?'),
  dob: words(
    'dob',
    'd\\.o\\.b\\.?',
    'born',
    `date${SEP}of${SEP}birth`,
    `birth${SEP}date`,
    'birthday',
    'birthdate',
    'تاريخ الميلاد',
  ),
  cpf: words('cpf'),
  pesel: words('pesel'),
  personnummer: words('personnummer', 'personnr', 'pnr'),
  bsn: words('bsn', 'burgerservicenummer', 'sofi(?:nummer)?'),
  cn: words(
    '身份证(?:号码?)?',
    `resident${SEP}id`,
    `(?:prc|chinese|china)${SEP}id`,
  ),
  tw: words('身分證(?:字號)?', `(?:taiwan|roc)${SEP}id`, `national${SEP}id`),
  hk: words('hkid', `hong${SEP}kong${SEP}id`, '香港身份證'),
  no: words(
    'fødselsnummer',
    'fodselsnummer',
    'personnummer',
    `norwegian${SEP}id`,
  ),
  th: words(
    `thai${SEP}id`,
    `national${SEP}id`,
    'เลขประจำตัวประชาชน',
    'บัตรประชาชน',
  ),
  il: words(
    `teudat${SEP}zehut`,
    'תעודת זהות',
    `israeli${SEP}id`,
    't\\.z\\.?',
    'ת\\.ז',
  ),
};

// Each rule: the token type, a label, the vendored rule or source, and one or
// more candidate shapes; `context` names the words a shape needs.
export const ID_RULES = [
  {
    type: 'US_SSN',
    name: 'US Social Security number',
    label: 'US Social Security numbers',
    source: 'SSA assignment rules; Presidio UsSsnRecognizer invalid list',
    shapes: [
      { re: `${B}\\d{3}([- ])\\d{2}\\1\\d{4}${A}` },
      { re: `${B}\\d{9}${A}`, context: CONTEXT.ssn },
    ],
    validate: validSsn,
  },
  {
    type: 'US_ITIN',
    name: 'US ITIN',
    label: 'US ITINs',
    source: 'IRS Publication 4757',
    shapes: [
      { re: `${B}9\\d{2}([- ])\\d{2}\\1\\d{4}${A}` },
      { re: `${B}9\\d{8}${A}`, context: CONTEXT.itin },
    ],
    validate: validItin,
  },
  {
    type: 'UK_NINO',
    name: 'UK National Insurance number',
    label: 'UK National Insurance numbers',
    source: 'HMRC NIM39110',
    shapes: [
      {
        // Upper or lower case, with or without a space between the pairs
        // (`AB 12 34 56 C`, `PR 123612C`, `ab123456c`), as Presidio's
        // UkNinoRecognizer allows.
        re: `(?<![\\p{L}\\p{N}_])(?!BG|GB|KN|NK|NT|TN|ZZ|PP ?99 ?99 ?99 ?P)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\\d{2} ?\\d{2} ?\\d{2} ?[A-D](?![\\p{L}\\p{N}_])`,
        flags: 'i',
      },
    ],
  },
  {
    type: 'QATAR_ID',
    name: 'Qatar ID number',
    label: 'Qatar ID numbers',
    source: 'QID structure; ISO 3166-1 numeric (i18n-iso-countries)',
    shapes: [{ re: `${B}[23٢٣]${D}{10}${A}`, context: CONTEXT.qatar }],
    validate: validQatarId,
  },
  {
    type: 'IN_AADHAAR',
    name: 'Aadhaar number',
    label: 'Aadhaar numbers',
    source: "validator.isIdentityCard('IN'): Verhoeff check digit",
    shapes: [
      { re: `${B}[2-9]\\d{3} \\d{4} \\d{4}${A}`, context: CONTEXT.aadhaar },
      { re: `${B}[2-9]\\d{11}${A}`, context: CONTEXT.aadhaar },
    ],
    validate: (v) => isIdentityCard(v, 'IN'),
  },
  {
    type: 'IN_PAN',
    name: 'Indian PAN',
    label: 'Indian PANs',
    source: 'Presidio InPanRecognizer format',
    shapes: [
      {
        re: `(?<![\\p{L}\\p{N}_])[A-Z]{3}[ABCFGHJLPT][A-Z]\\d{4}[A-Z](?![\\p{L}\\p{N}_])`,
        context: CONTEXT.pan,
      },
    ],
  },
  {
    type: 'PK_CNIC',
    name: 'Pakistani CNIC number',
    label: 'Pakistani CNIC numbers',
    source: "validator.isIdentityCard('PK')",
    shapes: [
      { re: `${B}[1-7]\\d{4}-\\d{7}-[1-9]${A}` },
      {
        re: `${B}[1-7]\\d{11}[1-9]${A}`,
        context: CONTEXT.cnic,
        normalize: (v) => `${v.slice(0, 5)}-${v.slice(5, 12)}-${v.slice(12)}`,
      },
    ],
    validate: (v) => isIdentityCard(v, 'PK'),
  },
  {
    type: 'EMIRATES_ID',
    name: 'Emirates ID number',
    label: 'Emirates ID numbers',
    source: 'Emirates ID format 784-YYYY-NNNNNNN-N',
    shapes: [
      { re: `${B}784-(?:19|20)\\d{2}-\\d{7}-\\d${A}` },
      { re: `${B}784(?:19|20)\\d{10}${A}`, context: CONTEXT.emirates },
    ],
  },
  {
    // Saudi citizens: 10 digits starting with 1, check digit.
    type: 'SAUDI_NID',
    name: 'Saudi national ID number',
    label: 'Saudi national ID numbers',
    source: 'Saudi-ID-Validator validateSAID',
    shapes: [{ re: `${B}[1١]${D}{9}${A}`, context: CONTEXT.saudiNid }],
    validate: (v) => validateSAID(v) === '1',
  },
  {
    // Residents (iqama): 10 digits starting with 2, the same check digit.
    type: 'IQAMA',
    name: 'Saudi iqama number',
    label: 'Saudi iqama numbers',
    source: 'Saudi-ID-Validator validateSAID',
    shapes: [{ re: `${B}[2٢]${D}{9}${A}`, context: CONTEXT.iqama }],
    validate: (v) => validateSAID(v) === '2',
  },
  {
    type: 'BR_CPF',
    name: 'Brazilian CPF number',
    label: 'Brazilian CPF numbers',
    source: "validator.isTaxID('pt-BR')",
    shapes: [
      { re: `${B}\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}${A}` },
      { re: `${B}\\d{11}${A}`, context: CONTEXT.cpf },
    ],
    validate: (v) => isTaxID(v, 'pt-BR'),
  },
  {
    type: 'PL_PESEL',
    name: 'Polish PESEL number',
    label: 'Polish PESEL numbers',
    source: "validator.isIdentityCard('PL')",
    shapes: [{ re: `${B}\\d{11}${A}`, context: CONTEXT.pesel }],
    validate: (v) => isIdentityCard(v, 'PL'),
  },
  {
    type: 'SE_PERSONNUMMER',
    name: 'Swedish personnummer',
    label: 'Swedish personnummer',
    source: "validator.isTaxID('sv-SE')",
    shapes: [
      {
        re: `${B}(?:\\d{2})?\\d{6}[-+]?\\d{4}${A}`,
        context: CONTEXT.personnummer,
      },
    ],
    validate: (v) => isTaxID(v, 'sv-SE'),
  },
  {
    type: 'NL_BSN',
    name: 'Dutch BSN',
    label: 'Dutch BSNs',
    source: "validator.isTaxID('nl-NL'): the 11-proof",
    shapes: [
      {
        re: `${B}(?:\\d{9}|\\d{4}\\.\\d{2}\\.\\d{3})${A}`,
        context: CONTEXT.bsn,
        normalize: (v) => v.replace(/\./gu, ''),
      },
    ],
    validate: (v) => isTaxID(v, 'nl-NL'),
  },
  {
    type: 'CN_RESIDENT_ID',
    name: 'Chinese resident ID number',
    label: 'Chinese resident ID numbers',
    source: "validator.isIdentityCard('zh-CN')",
    shapes: [{ re: `${B}[1-9]\\d{16}[\\dX]${A}`, context: CONTEXT.cn }],
    validate: (v) => isIdentityCard(v, 'zh-CN'),
  },
  {
    type: 'TW_NATIONAL_ID',
    name: 'Taiwanese national ID number',
    label: 'Taiwanese national ID numbers',
    source: "validator.isIdentityCard('zh-TW')",
    shapes: [
      {
        re: `(?<![\\p{L}\\p{N}_])[A-Z][12]\\d{8}(?![\\p{L}\\p{N}_])`,
        context: CONTEXT.tw,
      },
    ],
    validate: (v) => isIdentityCard(v, 'zh-TW'),
  },
  {
    type: 'HK_IDENTITY_CARD',
    name: 'Hong Kong identity card number',
    label: 'Hong Kong identity card numbers',
    source: "validator.isIdentityCard('zh-HK')",
    shapes: [
      {
        re: `(?<![\\p{L}\\p{N}_])[A-Z]{1,2}\\d{6}(?:\\([0-9A]\\)|\\[[0-9A]\\])`,
      },
      {
        re: `(?<![\\p{L}\\p{N}_])[A-Z]{1,2}\\d{6}[0-9A](?![\\p{L}\\p{N}_])`,
        context: CONTEXT.hk,
      },
    ],
    validate: (v) => isIdentityCard(v, 'zh-HK'),
  },
  {
    type: 'NO_FODSELSNUMMER',
    name: 'Norwegian fødselsnummer',
    label: 'Norwegian fødselsnummer',
    source: "validator.isIdentityCard('NO')",
    shapes: [{ re: `${B}\\d{11}${A}`, context: CONTEXT.no }],
    validate: (v) => isIdentityCard(v, 'NO'),
  },
  {
    type: 'TH_TNIN',
    name: 'Thai national ID number',
    label: 'Thai national ID numbers',
    source: "validator.isIdentityCard('TH')",
    shapes: [{ re: `${B}[1-8]\\d{12}${A}`, context: CONTEXT.th }],
    validate: (v) => isIdentityCard(v, 'TH'),
  },
  {
    type: 'IL_ID',
    name: 'Israeli ID number',
    label: 'Israeli ID numbers',
    source: "validator.isIdentityCard('he-IL')",
    shapes: [{ re: `${B}\\d{9}${A}`, context: CONTEXT.il }],
    validate: (v) => isIdentityCard(v, 'he-IL'),
  },
  {
    type: 'MALAYSIA_NRIC',
    name: 'Malaysian NRIC (MyKad) number',
    label: 'Malaysian NRIC (MyKad) numbers',
    source: 'JPN YYMMDD-PB-###G: a real date and a JPN place-of-birth code',
    shapes: [
      { re: `${B}\\d{6}-\\d{2}-\\d{4}${A}` },
      { re: `${B}\\d{12}${A}`, context: CONTEXT.nric },
    ],
    validate: validMalaysiaNric,
  },
  {
    type: 'PASSPORT',
    name: 'passport number',
    label: 'passport numbers (GB, US, MY)',
    source: "validator.isPassportNumber('GB' | 'US' | 'MY')",
    shapes: [
      {
        re: `(?<![\\p{L}\\p{N}_])(?:[A-Z]\\d{8}|\\d{9})(?![\\p{L}\\p{N}_])`,
        context: CONTEXT.passport,
      },
    ],
    validate: (v) =>
      ['GB', 'US', 'MY'].some((country) => isPassportNumber(v, country)),
  },
  {
    type: 'DOB',
    name: 'date of birth',
    label: 'dates of birth',
    source: 'a real calendar date from 1900 to five years ago',
    shapes: [
      {
        re: `${B}(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.-]\\d{1,2}[/.-](?:\\d{4}|\\d{2}))${A}`,
        context: CONTEXT.dob,
      },
      {
        re: `(?<![\\p{L}\\p{N}])(?:\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+'?(?:\\d{4}|\\d{2})|${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+'?(?:\\d{4}|\\d{2}))(?![\\p{L}\\p{N}])`,
        flags: 'i',
        context: CONTEXT.dob,
      },
    ],
    validate: validBirthDate,
  },
];

for (const rule of ID_RULES)
  for (const shape of rule.shapes)
    shape.pattern = new RegExp(shape.re, `gu${shape.flags ?? ''}`);

// All numbers `rule` finds in `text`: [{ start, end }].
export function findIds(rule, text) {
  const out = [];
  for (const shape of rule.shapes) {
    shape.pattern.lastIndex = 0;
    for (const m of text.matchAll(shape.pattern)) {
      const start = m.index;
      const end = start + m[0].length;
      if (shape.context && !hasContext(text, start, end, shape.context))
        continue;
      const ascii = toAsciiDigits(m[0]);
      const value = shape.normalize ? shape.normalize(ascii) : ascii;
      if (rule.validate && !rule.validate(value)) continue;
      if (!out.some((o) => o.start < end && start < o.end))
        out.push({ start, end });
    }
  }
  return out;
}
