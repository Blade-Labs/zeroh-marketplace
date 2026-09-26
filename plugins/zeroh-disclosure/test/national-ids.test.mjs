// SPDX-License-Identifier: AGPL-3.0-only

// National IDs, tax numbers and IP addresses. Fake or published sample values
// only (the validator.js, Presidio and IRS/SSA examples cited below).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectSensitiveData } from '../lib/detector.js';
import { detectionCatalog } from '../lib/detector.js';
import { zerohDisclosurePolicyV1 } from '../lib/policies/zeroh-disclosure.v1.js';
import { PERSONAL_DATA_KINDS } from '../lib/pii/index.js';

const found = (text, profile = 'tool') =>
  detectSensitiveData(text, { profile, region: null }).map((f) => [
    f.type,
    text.slice(f.start, f.end),
  ]);
const one = (text, type, value) =>
  assert.deepEqual(found(text), [[type, value]], text);
const none = (text) => assert.deepEqual(found(text), [], text);

// ---- IP addresses (validator.js isIP) ----------------------------------------

test('public and private IP addresses are masked, v4 and v6', () => {
  for (const ip of [
    '8.8.8.8',
    '10.42.1.17',
    '192.168.0.1',
    '172.16.5.4',
    '100.64.0.1',
    '2600:1f18:abcd::1',
    'fd12:3456:789a::1',
  ])
    one(`connect to ${ip} now`, 'IP_ADDRESS', ip);
  one('http://[2600:1f18::1]:8080/', 'IP_ADDRESS', '2600:1f18::1');
  one('allow 10.0.0.7/32', 'IP_ADDRESS', '10.0.0.7');
});

test('loopback, unspecified, broadcast, netmasks, link-local, multicast and documentation ranges are not masked', () => {
  for (const text of [
    'listen 127.0.0.1:3000',
    'bind 0.0.0.0',
    'host ::1',
    'host ::',
    '255.255.255.255',
    'netmask 255.255.255.0',
    'metadata http://169.254.169.254/latest',
    'mcast 224.0.0.251',
    'doc 192.0.2.10 198.51.100.7 203.0.113.9 2001:db8::1',
    'fe80::1%eth0',
  ])
    none(text);
});

test('versions, section numbers, longer dotted runs, times, MACs and slices are not IP addresses', () => {
  for (const text of [
    'v1.2.3.4',
    'pkg@1.2.3.4',
    'version 1.2.3.4',
    '__version__ = "0.5.1.2"',
    'see section 13.2.5.8',
    'build 1.2.3.4.5',
    'at 12:30:45',
    'mac aa:bb:cc:dd:ee:ff',
    'std::vector<int>',
    'x = s[1::2]',
    'y = s[-2::-1]',
  ])
    none(text);
});

// validator.js 13.15.35 test/validators.test.js, "should validate IP
// addresses" (MIT): valid addresses stay found in text.
test('validator.js isIP test cases', () => {
  for (const ip of [
    '1.2.3.4',
    '::ffff:127.0.0.1',
    '2001:db8:0000:1:1:1:1:1'.replace('db8', 'db9'),
    '1:2:3:4:5:6:7:8',
  ])
    one(`addr ${ip} end`, 'IP_ADDRESS', ip);
  for (const ip of [
    '256.0.0.0',
    '0.0.0.256',
    '::ffff:287.0.0.1',
    '1:2:3:4:5:6:7:8:9',
  ])
    none(`addr ${ip} end`);
});

// ---- US SSN and ITIN ----------------------------------------------------------

// Presidio 2.2.364 tests/test_us_ssn_recognizer.py (MIT), the dash and space
// forms; SSA rules for area, group and serial.
test('US SSNs: SSA assignment rules and the published invalid numbers', () => {
  one('078-05-1123', 'US_SSN', '078-05-1123');
  one('abc 078 05 1123 abc', 'US_SSN', '078 05 1123');
  one('ssn 536-22-3490', 'US_SSN', '536-22-3490');
  for (const text of [
    '078-05-1120', // Woolworth's wallet sample
    '219-09-9999', // SSA pamphlet sample
    '123-45-6789',
    '987-65-4320',
    '000-12-3456',
    '666-12-3456',
    '078-00-1123',
    '078-05-0000',
    '111-11-1111',
    '078-05 1123', // mixed separators
  ])
    none(text);
});

test('a bare 9-digit SSN needs a context word nearby, a key name, or its column', () => {
  none('order 536223490 shipped');
  one('SSN: 536223490', 'US_SSN', '536223490');
  one('{"ssn": "536223490"}', 'US_SSN', '536223490');
  one('social security number 536223490', 'US_SSN', '536223490');
  assert.deepEqual(found('name,ssn\nAda,536223490\n'), [
    ['US_SSN', '536223490'],
  ]);
  none(
    'ssn is on another field; this is a long unrelated sentence, id 536223490',
  );
});

// IRS Publication 4757: 9XX with the 4th-5th digits 50-65, 70-88, 90-92, 94-99.
test('US ITINs: 9XX with the IRS group ranges', () => {
  one('ITIN 912-70-1234', 'US_ITIN', '912-70-1234');
  one('itin: 912701234', 'US_ITIN', '912701234');
  for (const text of [
    '912-66-1234',
    '912-89-1234',
    '912-93-1234',
    '987-65-4325',
  ])
    none(text);
});

// ---- UK NINO -------------------------------------------------------------------

// Presidio 2.2.364 tests/test_uk_nino_recognizer.py (MIT); HMRC NIM39110.
test('UK NINOs follow HMRC NIM39110', () => {
  for (const [text, value] of [
    ['AA 12 34 56 B', 'AA 12 34 56 B'],
    ['hh 01 02 03 d', 'hh 01 02 03 d'],
    ['tw987654a', 'tw987654a'],
    ['nino: PR 123612C', 'PR 123612C'],
    ['Here is my National Insurance Number YZ 61 48 68 B', 'YZ 61 48 68 B'],
  ])
    one(text, 'UK_NINO', value);
  for (const text of [
    'AA 12 34 56 H',
    'AB 12 34 56 1',
    'FQ 00 00 00 C',
    'BG123612A',
    'nino: nt 99 88 77 a',
    'UV 98 76 54 B',
    'AO 12 34 56 A', // O is never the second letter
    'PP999999P',
  ])
    none(text);
});

// ---- Qatar ID ----------------------------------------------------------------------

test('Qatar IDs: century, birth year and an ISO 3166 nationality, next to a context word', () => {
  one('QID 28463400123', 'QATAR_ID', '28463400123');
  one('qatar_id=29925012345', 'QATAR_ID', '29925012345');
  one('Qatari ID: 30163412345', 'QATAR_ID', '30163412345');
  none('order 28463400123'); // no context
  none('QID 28499900123'); // 999 is no ISO 3166 country
  none('QID 48463400123'); // century digit 2 or 3
});

// ---- more IDs, from validator.js 13.15.35 test/validators.test.js (MIT) ----------

test('validator.js isIdentityCard and isTaxID cases, with their guards', () => {
  const cases = [
    ['IN_AADHAAR', 'Aadhaar 2984 4886 3364', '2984 4886 3364'],
    ['IN_AADHAAR', 'aadhaar: 298448863364', '298448863364'],
    ['PK_CNIC', '45504-4185771-3', '45504-4185771-3'],
    ['PK_CNIC', 'CNIC 4550441857713', '4550441857713'],
    ['PL_PESEL', 'PESEL 99012229019', '99012229019'],
    ['NO_FODSELSNUMMER', 'fødselsnummer 09053426694', '09053426694'],
    ['TH_TNIN', 'Thai ID 1101230000001', '1101230000001'],
    ['IL_ID', 'teudat zehut 219472156', '219472156'],
    ['CN_RESIDENT_ID', '身份证 235407195106112745', '235407195106112745'],
    ['TW_NATIONAL_ID', 'Taiwan ID B176944193', 'B176944193'],
    ['HK_IDENTITY_CARD', 'W520128(7)', 'W520128(7)'],
    ['HK_IDENTITY_CARD', 'A494866[4]', 'A494866[4]'],
    ['BR_CPF', '111.444.777-35', '111.444.777-35'],
    ['BR_CPF', 'CPF 52998224725', '52998224725'],
    ['SE_PERSONNUMMER', 'personnummer 640823-3234', '640823-3234'],
    ['SE_PERSONNUMMER', 'personnummer 19640823-3233', '19640823-3233'],
    ['NL_BSN', 'BSN 174559434', '174559434'],
  ];
  for (const [type, text, value] of cases) one(text, type, value);
  for (const text of [
    'Aadhaar 2984 4886 3365',
    '08000-1234567-5',
    'PESEL 99212229019',
    'fødselsnummer 09053426699',
    'Thai ID 1101230000007',
    'teudat zehut 123456789',
    '身份证 235407195106112742',
    'Taiwan ID A185034995',
    'O962472(9)',
    '170.691.440-72',
    '123.456.789-00',
    'personnummer 160230-3231',
    'BSN 17455943',
  ])
    none(text);
});

test('IDs whose digits alone are common need their context word', () => {
  for (const text of [
    '2984 4886 3364',
    '298448863364',
    '4550441857713',
    '99012229019',
    '09053426694',
    '1101230000001',
    '219472156',
    '235407195106112745',
    'B176944193',
    '52998224725',
    '640823-3234',
    '174559434',
    'ABCPD1234Z',
  ])
    none(`value ${text} here`);
});

test('Indian PAN and Emirates ID formats, and the Saudi NID and iqama check digit', () => {
  one('My PAN number is ABBPM4567S', 'IN_PAN', 'ABBPM4567S');
  none('PAN ABCD1234'); // Presidio test: too short
  one('784-1990-1234567-6', 'EMIRATES_ID', '784-1990-1234567-6');
  one('Emirates ID 784199012345676', 'EMIRATES_ID', '784199012345676');
  none('784-1890-1234567-6');
  // validateSAID: 1 for citizens (SAUDI_NID), 2 for residents (IQAMA), then
  // the check digit; the context words include ZeroH Enterprise's.
  one('National ID: 1000000008', 'SAUDI_NID', '1000000008');
  one('citizen 1000000008', 'SAUDI_NID', '1000000008');
  one('Iqama 2000000006', 'IQAMA', '2000000006');
  one('resident id: 2000000006', 'IQAMA', '2000000006');
  none('Iqama 2000000001'); // check digit
  none('Iqama 1000000008'); // a citizen number is no iqama
  none('value 1000000008 and 2000000006 here');
});

// ---- reused from Blade Labs' ai-ui-chat detector (src/services/pii-detector.ts)

test('Saudi and Qatar IDs in Arabic-Indic digits, with Arabic context words', () => {
  one('هوية ١٠٠٠٠٠٠٠٠٨', 'SAUDI_NID', '١٠٠٠٠٠٠٠٠٨');
  one('الهوية 1000000008', 'SAUDI_NID', '1000000008');
  one('إقامة ٢٠٠٠٠٠٠٠٠٦', 'IQAMA', '٢٠٠٠٠٠٠٠٠٦');
  one('QID ٢٨٤٦٣٤٠٠١٢٣', 'QATAR_ID', '٢٨٤٦٣٤٠٠١٢٣');
  none('إقامة ٢٠٠٠٠٠٠٠٠١'); // check digit
  none('value ١٠٠٠٠٠٠٠٠٨ here'); // no context word
});

test('Malaysian NRIC: a real date and a JPN place-of-birth code', () => {
  one('IC 850101-14-5678', 'MALAYSIA_NRIC', '850101-14-5678');
  one('NRIC: 850101145678', 'MALAYSIA_NRIC', '850101145678');
  none('850231-14-5678'); // no 31 February
  none('851301-14-5678'); // no month 13
  none('850101-00-5678'); // 00 is no place code
  none('850101-70-5678');
  none('value 850101145678 here'); // bare digits need a context word
});

// validator.js 13.15.35 test/validators.test.js, "should validate passport
// number" for GB, US and MY (MIT).
test('passport numbers (GB, US, MY) only next to the word passport', () => {
  for (const value of [
    '925076473',
    '107182890',
    '790369937',
    'A90583942',
    'E00007734',
    'H12345678',
    'K43143233',
  ])
    one(`passport: ${value}`, 'PASSPORT', value);
  for (const value of ['A012345678', 'K000000000', '0123456789', 'A1234567'])
    none(`passport: ${value}`);
  none('order 925076473');
  none('ref A90583942 shipped');
});

test('dates of birth: a real date from 1900 to five years ago, next to dob/born/birthday', () => {
  for (const [text, value] of [
    ['DOB: 1985-03-12', '1985-03-12'],
    ['born on 12/03/1985', '12/03/1985'],
    ['birthday 12th March 1985', '12th March 1985'],
    ['date of birth March 12, 85', 'March 12, 85'],
    ['تاريخ الميلاد 1990-07-04', '1990-07-04'],
  ])
    one(text, 'DOB', value);
  for (const text of [
    `dob ${new Date().getUTCFullYear() - 1}-01-01`, // less than five years ago
    'dob 1899-12-31',
    'born 1985-02-30',
    'release 1985-03-12', // no context word
    'created 12/03/1985',
    '"vitest": "4.1.10"',
  ])
    none(text);
});

// validator.js 13.15.35 test/validators.test.js, "should validate Bitcoin
// addresses" and "should validate ethereum addresses" (MIT).
test('Bitcoin and Ethereum addresses; an Ethereum address in tool output needs a wallet word', () => {
  for (const address of [
    '1MUz4VMYui5qY1mxUiG8BQ1Luv6tqkvaiL',
    '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
    '14qViLJfdGaP4EeHnDyJbEGQysnCpwk3gd',
    'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  ])
    one(`pay ${address} now`, 'CRYPTO', address);
  for (const text of [
    '3J98t1WpEZ73CNmQviecrnyiWrnqh0WNL0',
    '4J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
    'BC1QW508D6QEJXTDG4Y5R3ZARVAYR0C5XW7KV8F3T4',
    'uuid 12345678123456781234567812345678',
    'md5 3a4f5b6c7d8e9f1a2b3c4d5e6f7a8b9c', // plain hex
  ])
    none(text);
  for (const eth of [
    '0x683E07492fBDfDA84457C16546ac3f433BFaa128',
    '0x88dA6B6a8D3590e88E0FcadD5CEC56A7C9478319',
  ]) {
    none(`const CONTRACT = ${eth};`); // tool output: a contract or a hash
    one(`wallet: ${eth}`, 'CRYPTO', eth);
    assert.deepEqual(found(`send it to ${eth}`, 'prompt'), [['CRYPTO', eth]]);
  }
  none('keccak 0xFCb5AFB808b5679b4911230Aa41FfCD0cd335b422222');
});

// ---- the kinds are one list ------------------------------------------------------

test('the policy masks, and the catalog lists, every kind lib/pii detects', () => {
  const types = PERSONAL_DATA_KINDS.map(({ type }) => type);
  assert.equal(new Set(types).size, types.length);
  const mask = zerohDisclosurePolicyV1.rules.find(
    (rule) => rule.id === 'ZEROH-MASK-PERSONAL-DATA',
  ).mask_categories;
  for (const type of types) assert.ok(mask.includes(type), type);
  assert.deepEqual(detectionCatalog().personal_data, [...types].sort());
});
