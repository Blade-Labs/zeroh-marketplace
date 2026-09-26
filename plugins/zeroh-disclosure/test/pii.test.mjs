// SPDX-License-Identifier: AGPL-3.0-only

// Personal data: the vendored validators decide, the candidate finders only
// propose. Fake values only.
import './helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectSensitiveData } from '../lib/detector.js';
import { phoneRegion } from '../lib/pii/phone.js';

const found = (text, profile = 'tool', region) =>
  detectSensitiveData(text, { profile, region }).map((f) => [
    f.type,
    text.slice(f.start, f.end),
  ]);

// The owner's unmask demo (T-41): every address is masked whole.
test('email addresses are masked whole, whatever their local part or domain', () => {
  for (const address of [
    "anna.o'neil@example.co.uk",
    'lars+work@example.com',
    'jürgen@müller.example',
    'sam@sub.mail.example.org',
    'jane.doe@example.com',
    'first_last-1@exa-mple.io',
    'xn--jrgen-kva@xn--mller-kva.example',
    '"quoted name"@example.com',
    'user@[192.0.2.1]',
  ]) {
    const line = `rejected ${address} by validateEmail`;
    for (const profile of ['tool', 'prompt'])
      assert.deepEqual(found(line, profile), [['EMAIL', address]], address);
  }
});

test('code around an address is not masked, and look-alikes are not addresses', () => {
  for (const [line, expected] of [
    ["const to = 'bob@example.com';", [['EMAIL', 'bob@example.com']]],
    ['email: "bob@example.com",', [['EMAIL', 'bob@example.com']]],
    [
      'https://x.example/?email=bob@example.com&x=1',
      [['EMAIL', 'bob@example.com']],
    ],
    ['<a href="mailto:jane@example.com">', [['EMAIL', 'jane@example.com']]],
    ['git@github.com:org/repo.git', []],
    ['npm i @scope/pkg@1.2.3', []],
    ['user@localhost', []],
    ['decorator @Component', []],
    ['icon@2x.png', []],
    ['foo.bar@v1.2', []],
    ['ssh://deploy@host.example.com', []],
    ['deploy@host.example.com:/srv/app', []],
    ["locale 'sd_IN@devanagari.UTF-8'", []],
    ['Signed-off-by: bot <12345+bot@users.noreply.github.com>', []],
  ]) {
    assert.deepEqual(found(line), expected, line);
  }
});

// Cases from validator.js 13.15.35, test/validators.test.js ("should validate
// email addresses", "should validate IBAN", "should validate credit cards"),
// MIT licence, https://github.com/validatorjs/validator.js/blob/13.15.35/test/validators.test.js
// — used inside a sentence, as the finder meets them.
test('validator.js test cases: valid values are found whole in text', () => {
  const cases = {
    EMAIL: [
      'foo@bar.com',
      'x@x.au',
      'foo@bar.com.au',
      'foo+bar@bar.com',
      'hans@m端ller.com',
      'test123+ext@gmail.com',
      'some.name.midd.leNa.me.and.locality+extension@GoogleMail.com',
      '"foobar"@example.com',
      '"  foo  m端ller "@example.com',
      'test.1@gmail.com',
      'test@1337.com',
    ],
    IBAN: [
      'SC52BAHL01031234567890123456USD',
      'MT31MALT01100000000000000000123',
      'BE71 0961 2345 6769',
      'FR76 3000 6000 0112 3456 7890 189',
      'DE91 1000 0000 0123 4567 89',
      'GB98 MIDL 0700 9312 3456 78',
      'IT60X0542811101000000123456',
      'IE29AIBK93115212345678',
    ],
    CARD_NUMBER: [
      '375556917985515',
      '36050234196908',
      '4716461583322103',
      '4716-2210-5188-5662',
      '4929 7226 5379 7141',
      '5398228707871527',
      '6283875070985593',
      '2222155765072228',
      '4716989580001715211',
    ],
  };
  for (const [type, values] of Object.entries(cases)) {
    for (const value of values) {
      const line = `value ${value} here`;
      assert.deepEqual(found(line), [[type, value]], value);
    }
  }
});

test('validator.js test cases: invalid values stay text', () => {
  for (const value of [
    'invalidemail@',
    '@invalid.com',
    'foo@_bar.com',
    'z@co.c',
    'multiple..dots@stillinvalid.com',
    'ends.with.dot.@gmail.com',
    'somename@ｇｍａｉｌ.com',
    'FR14 2004 1010 0505 0001 3',
    'VG46H07Y0223060094359858',
    'IE95TE8270900834048660',
    'PS072435171802145240705922007',
    '5398228707871528',
    '2718760626256571',
    '2721465526338453',
    '2220175103860763',
    'prefix6234917882863855',
    '6234917882863855suffix',
    '4716989580001715213',
  ]) {
    assert.deepEqual(found(`value ${value} here`), [], value);
  }
});

test('a CSV row: each column is found on its own', () => {
  const row =
    'name,email,phone,qatar_id,national_id,iban,card\nAlice Example,alice.zerohfake@example.qa,+974 5512 3456,28463400123,00000000T,QA58DOHB00001234567890ABCDEFG,4532015112830366';
  assert.deepEqual(found(row), [
    ['EMAIL', 'alice.zerohfake@example.qa'],
    ['PHONE_NUMBER', '+974 5512 3456'],
    ['QATAR_ID', '28463400123'],
    ['ES_NIF', '00000000T'],
    ['IBAN', 'QA58DOHB00001234567890ABCDEFG'],
    ['CARD_NUMBER', '4532015112830366'],
  ]);
});

test('an IBAN followed by a short number is found without it', () => {
  assert.deepEqual(
    found('I want my deposit in DE89370400440532013000 2 days from today.'),
    [['IBAN', 'DE89370400440532013000']],
  );
});

test('national IDs are found only when their check character validates', () => {
  const text =
    'DNI 12345678Z NIE X1234567L CF RSSMRA85T10A562S hetu 131052-308T';
  assert.deepEqual(found(text), [
    ['ES_NIF', '12345678Z'],
    ['ES_NIE', 'X1234567L'],
    ['IT_FISCAL_CODE', 'RSSMRA85T10A562S'],
    ['FI_PERSONAL_IDENTITY_CODE', '131052-308T'],
  ]);
  assert.deepEqual(
    found('DNI 12345678A NIE X1234567X CF RSSMRA85T10A562T hetu 131052-308U'),
    [],
  );
});

// Case from libphonenumber-js v1.13.14 (commit 1d7eda2a),
// source/findPhoneNumbersInText.test.js, MIT licence.
test('libphonenumber-js test case: international numbers always, national ones with a region', () => {
  const text =
    'The number is +7 (800) 555-35-35 and not (213) 373-4253 as written in the document.';
  assert.deepEqual(found(text, 'tool', 'US'), [
    ['PHONE_NUMBER', '+7 (800) 555-35-35'],
  ]);
  assert.deepEqual(found(text, 'prompt', null), [
    ['PHONE_NUMBER', '+7 (800) 555-35-35'],
  ]);
  assert.deepEqual(found(text, 'prompt', 'US'), [
    ['PHONE_NUMBER', '+7 (800) 555-35-35'],
    ['PHONE_NUMBER', '(213) 373-4253'],
  ]);
});

test('phone numbers: a written country code must be the parsed one; ids, sizes and dates are not phones', () => {
  for (const text of [
    '+12 345 678 901',
    '+1 2026 0925 1011',
    'a+16777216',
    'Order 20250925001 and invoice INV-2026-000123 failed on 2026-09-25 at 14:30',
    'const c1 = [2277735313, 289559509];',
    'h = 2246822507 ^ 3266489909',
  ]) {
    for (const region of ['US', 'GB', 'DE', 'QA'])
      assert.deepEqual(found(text, 'prompt', region), [], `${region}: ${text}`);
  }
});

test('the default region comes from ZEROH_PHONE_REGION, else the locale', () => {
  assert.equal(phoneRegion({ ZEROH_PHONE_REGION: 'gb' }), 'GB');
  assert.equal(
    phoneRegion({ ZEROH_PHONE_REGION: 'none', LANG: 'en_US.UTF-8' }),
    null,
  );
  assert.equal(phoneRegion({ LANG: 'de_DE.UTF-8' }), 'DE');
  assert.equal(
    phoneRegion({ LC_ALL: 'fi_FI@euro', LANG: 'en_US.UTF-8' }),
    'FI',
  );
  assert.equal(
    phoneRegion({ LC_TELEPHONE: 'ar_QA.UTF-8', LANG: 'en_US.UTF-8' }),
    'QA',
  );
  assert.equal(phoneRegion({ LANG: 'C.UTF-8' }), null);
  assert.equal(phoneRegion({ LANG: 'POSIX' }), null);
  assert.equal(phoneRegion({}), null);
});
