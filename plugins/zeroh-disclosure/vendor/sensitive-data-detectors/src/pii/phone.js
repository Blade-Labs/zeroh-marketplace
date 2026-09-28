// Phone numbers, found by libphonenumber-js (vendor/libphonenumber-js, a
// pinned build with Google libphonenumber's full "max" metadata) with its
// PhoneNumberMatcher at the VALID leniency: a candidate counts only when the
// digits form a valid number for its region.
//
// International numbers (+CC …) are found everywhere. National numbers
// (`020 7946 0958`) are found only with a default region: the caller's, else
// the locale's territory (LC_ALL, LC_TELEPHONE, LANG — `en_GB.UTF-8` → GB).
// `C`/`POSIX` locales give none.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const libphonenumber = require('../../vendor/libphonenumber-js/libphonenumber-max.cjs');

export const LIBPHONENUMBER_VERSION = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../vendor/libphonenumber-js/SOURCE.json', import.meta.url),
    ),
    'utf8',
  ),
).version;

// The locale's default region for national-format numbers, or null.
export function phoneRegion(env = process.env) {
  for (const name of ['LC_ALL', 'LC_TELEPHONE', 'LANG']) {
    const value = String(env[name] ?? '').trim();
    if (!value) continue;
    const territory = /^[A-Za-z]{2,3}_([A-Za-z]{2})(?:[.@]|$)/u.exec(value);
    return territory ? supportedRegion(territory[1]) : null;
  }
  return null;
}

// The region in upper case when libphonenumber knows it, else null (`none`,
// `EU`, `x`).
export function supportedRegion(value) {
  const region = String(value).toUpperCase();
  return /^[A-Z]{2}$/u.test(region) && libphonenumber.isSupportedCountry(region)
    ? region
    : null;
}

// Every valid phone number in `text`: [{ start, end, international }].
export function findPhoneNumbers(text, { region = null } = {}) {
  if (!/\d/u.test(text)) return [];
  // A comma or semicolon ends a number: the matcher reads `,` and `;` as a
  // dial-string extension, which would join the next CSV column to the
  // number (`+974 5512 3456,0000…`) or drop the whole row. Replacing them
  // (same length, so offsets hold) keeps the number and nothing after it.
  const scan = text.replace(/[,;]/gu, '|');
  const matcher = new libphonenumber.PhoneNumberMatcher(scan, {
    ...(region ? { defaultCountry: region } : {}),
    leniency: 'VALID',
    v2: true,
  });
  const out = [];
  while (matcher.hasNext()) {
    const found = matcher.next();
    const raw = text.slice(found.startsAt, found.endsAt);
    const international = raw.startsWith('+');
    if (!international && !region) continue;
    // The country code as written must be the one the number parsed to
    // (`+12 345 678 901` is not +1 234 567 8901).
    if (international && !writtenAsParsed(raw, found.number)) continue;
    out.push({ start: found.startsAt, end: found.endsAt, international });
  }
  return out;
}

// True when an international number, as written, starts with the country
// calling code it parsed to. The code may share a digit group with the start
// of the national number (`+4420 7946 0958`, `+1202-555-0123`) when that group
// then ends where the international format ends a group; a number whose first
// group splits the national number where its country never does (the
// `+12 345 …` case above) is not read as that country's number.
function writtenAsParsed(raw, number) {
  const code = number.countryCallingCode;
  const groups = raw.slice(1).split(/\D+/u).filter(Boolean);
  if (groups.length < 2 || groups[0] === code) return true;
  if (!groups[0].startsWith(code)) return false;
  const national = number
    .formatInternational()
    .slice(1)
    .split(/\D+/u)
    .filter(Boolean)
    .slice(1);
  const lead = groups[0].length - code.length;
  let at = 0;
  for (const group of national.slice(0, -1))
    if ((at += group.length) === lead) return true;
  return false;
}
