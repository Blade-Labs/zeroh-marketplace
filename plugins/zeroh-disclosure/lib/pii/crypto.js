// SPDX-License-Identifier: AGPL-3.0-only

// Bitcoin and Ethereum wallet addresses: validator.js isBtcAddress and
// isEthereumAddress decide.
// - A Bitcoin candidate must mix letters and digits and must not be plain
//   hex: validator's base58 pattern alone also takes a long run of digits
//   (`1234…5678`) or an MD5 digest without a zero.
// - An Ethereum address is any `0x` and 40 hex digits, which in tool output
//   is as often a contract address or a key hash in code. Typed prompts mask
//   it everywhere; tool output only next to a word naming a wallet.

import { createRequire } from 'node:module';
import { hasContext } from './context.js';

const require = createRequire(import.meta.url);
const load = (name) => {
  const mod = require(`../../vendor/validator/lib/${name}.js`);
  return mod.default ?? mod;
};
const isBtcAddress = load('isBtcAddress');
const isEthereumAddress = load('isEthereumAddress');

const BTC =
  /(?<![\p{L}\p{N}_])(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[ac-hj-np-z02-9]{39,59})(?![\p{L}\p{N}_])/gu;
const ETH = /(?<![\p{L}\p{N}_])0x[0-9a-fA-F]{40}(?![\p{L}\p{N}_])/gu;
const WALLET =
  /(?<![\p{L}\p{N}])(?:wallet|(?:eth|ethereum|btc|bitcoin)[\s_.-]*(?:address|addr)|send[\s_-]*to|recipient|beneficiary)(?![\p{L}\p{N}])/iu;

export function findCryptoAddresses(text, { profile = 'prompt' } = {}) {
  const out = [];
  for (const m of text.matchAll(BTC)) {
    const legacy = !m[0].startsWith('bc1');
    if (!/[A-Za-z]/u.test(m[0].slice(1)) || !/\d/u.test(m[0])) continue;
    if (legacy && /^[0-9a-f]+$|^[0-9A-F]+$/u.test(m[0])) continue;
    if (isBtcAddress(m[0]))
      out.push({ start: m.index, end: m.index + m[0].length });
  }
  if (text.includes('0x')) {
    for (const m of text.matchAll(ETH)) {
      if (!isEthereumAddress(m[0])) continue;
      const end = m.index + m[0].length;
      if (profile === 'tool' && !hasContext(text, m.index, end, WALLET))
        continue;
      out.push({ start: m.index, end });
    }
  }
  return out;
}
