// SPDX-License-Identifier: AGPL-3.0-only

// IP addresses: validator.js isIP decides (IPv4 and IPv6). Public and
// private addresses are masked. ZeroH only proposes candidates and leaves
// out addresses that never identify a person or a network (IANA special-
// purpose registries, RFC 6890): loopback (127.0.0.0/8, ::1), unspecified
// (0.0.0.0/8, ::), broadcast and netmasks (255.255.255.255, 255.255.255.0 …),
// link-local (169.254.0.0/16, the cloud metadata address; fe80::/10),
// multicast and reserved (224.0.0.0/3; ff00::/8) and the documentation ranges
// (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, RFC 5737; 2001:db8::/32,
// RFC 3849). Also left out: dotted numbers that are versions or section
// numbers (`v1.2.3.4`, `pkg@1.2.3.4`, `__version__ = "0.5.1.2"`,
// `section 13.2.5.8`, `1.2.3.4.5`) and array slices (`a[1::2]`).

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const isIPModule = require('../../vendor/validator/lib/isIP.js');
const isIP = isIPModule.default ?? isIPModule;

const V4 =
  /(?<![\p{L}\p{N}_@]|\d\.)\d{1,3}(?:\.\d{1,3}){3}(?![\p{L}\p{N}_]|\.\d)/gu;
// A run of hex digits, colons and dots with at least two colons; isIP tells
// an address from a time (12:30:45), a MAC address or a C++ scope.
const V6 =
  /(?<![\p{L}\p{N}_:.])(?=[0-9A-Fa-f:.]*:[0-9A-Fa-f.]*:)[0-9A-Fa-f:.]{2,45}(?:%[\p{L}\p{N}_]+)?(?![\p{L}\p{N}_:])/gu;

const VERSION_BEFORE =
  /(?:(?<![a-z])(?:version|ver|release|rev|sections?|chapter)s?_*\s*[:=]?\s*["'(]?|§\s*|#section-)$/iu;

function netmask(address) {
  const bits = address
    .split('.')
    .map((o) => Number(o).toString(2).padStart(8, '0'))
    .join('');
  return /^1+0*$/u.test(bits) && address.startsWith('255.');
}

function neverPersonalV4(address) {
  const [a, b, c] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 127 ||
    address === '0.0.0.0' ||
    netmask(address) ||
    (a === 169 && b === 254) ||
    a >= 224 ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function neverPersonalV6(address) {
  const bare = address.replace(/%.*$/u, '').toLowerCase();
  return (
    /^(?:0{0,4}:){2,7}0{0,4}$/u.test(bare) || // ::, 0:0:…:0
    /^(?:0{0,4}:){2,7}0{0,3}1$/u.test(bare) || // ::1
    /^fe[89ab][0-9a-f]:/u.test(bare) || // link-local
    /^ff[0-9a-f]{2}:/u.test(bare) || // multicast
    /^2001:0?db8:/u.test(bare) // documentation
  );
}

export function findIpAddresses(text) {
  const out = [];
  if (text.includes('.')) {
    for (const m of text.matchAll(V4)) {
      if (!isIP(m[0], 4) || neverPersonalV4(m[0])) continue;
      const before = text.slice(Math.max(0, m.index - 16), m.index);
      if (/v$/iu.test(before) || VERSION_BEFORE.test(before)) continue;
      out.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  if (text.includes(':')) {
    for (const m of text.matchAll(V6)) {
      const value = m[0].replace(/[.:]+$/u, (tail) =>
        tail.startsWith('::') ? tail.slice(0, 2) : '',
      );
      if (!isIP(value, 6) || neverPersonalV6(value)) continue;
      // An index or slice in code: `a[1::2]`, `s[-2::-1]`.
      if (
        /[\p{L}\p{N}_)\]]\[-?$/u.test(
          text.slice(Math.max(0, m.index - 3), m.index),
        )
      )
        continue;
      out.push({ start: m.index, end: m.index + value.length });
    }
  }
  return out;
}
