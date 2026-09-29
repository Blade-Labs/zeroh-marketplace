// SPDX-License-Identifier: AGPL-3.0-only

// The vault's exact-match scope for plain words (1.0.0, detector exceptions
// redesign, A2). A plain word found by its surroundings (`password=<word>`,
// typed or in output) is masked where its key names it, with the same token
// each time, and never exact-matched bare in later text: the 1.0.0 report
// had such a word masked in every later file and command output. Values
// typed with digits or symbols, known values and reported values still
// match bare. Values are fake and assembled from parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vault } from '../lib/vault.js';
import { exactValueHits, scrub } from '../lib/secrets.js';
import { tempProject } from './helpers.mjs';

const WORD = 'pay' + 'load';
const TYPED_PW = 'Tr0ub4' + 'dor-9x';

function withHome(home, fn) {
  const prev = process.env.ZEROH_HOME;
  process.env.ZEROH_HOME = home;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.ZEROH_HOME;
    else process.env.ZEROH_HOME = prev;
  }
}

const typed = (text, vault) =>
  scrub(text, { vault, profile: 'prompt', findingSource: 'prompt' });
const output = (text, vault) => scrub(text, { vault, profile: 'tool' });

test('a typed plain word is masked where its key names it, not bare in later output', () => {
  const p = tempProject({ env: false });
  withHome(p.home, () => {
    const vault = new Vault(p.dir);
    const prompt = typed(`is it password=${WORD} or something else`, vault);
    assert.equal(prompt.replacements.length, 1);
    const token = prompt.replacements[0].token;
    assert.ok(!prompt.text.includes(WORD), prompt.text);

    const code = `const ${WORD} = await req.json();\nsend(${WORD});`;
    assert.equal(output(code, vault).text, code);
    assert.deepEqual(exactValueHits(code, { vault }), []);

    // Back beside its key, it is found again and gets the same token.
    const again = output(`password=${WORD}`, vault);
    assert.equal(again.text, `password=${token}`);
  });
});

test('a word ending a question is not exact-matched bare either', () => {
  const p = tempProject({ env: false });
  withHome(p.home, () => {
    const vault = new Vault(p.dir);
    typed(`is it password=${WORD}?`, vault);
    const code = `const x = ${WORD}?.body ?? ${WORD};`;
    assert.equal(output(code, vault).text, code);
  });
});

test('a typed password with digits or symbols is still exact-matched bare', () => {
  const p = tempProject({ env: false });
  withHome(p.home, () => {
    const vault = new Vault(p.dir);
    const prompt = typed(`my password=${TYPED_PW} for the db`, vault);
    const token = prompt.replacements[0].token;
    assert.equal(output(`echo ${TYPED_PW}`, vault).text, `echo ${token}`);
  });
});

test('only an ordinary prose word loses bare matching; a passphrase or mixed-case value keeps it', () => {
  const p = tempProject({ env: false });
  withHome(p.home, () => {
    const vault = new Vault(p.dir);
    // Symbol-bearing passphrases, mixed case, a long run of letters: typed
    // passwords, still matched bare in later output.
    for (const value of [
      'orchard-' + 'river-copper-lantern!',
      'orchard-' + 'river',
      'WqRtYuIoPa' + 'SdFgHjKlZxCvBn',
      'camel' + 'Case',
      'abcdefghijklmnopqrstuvw' + 'xyzab',
    ]) {
      const prompt = typed(`password=${value}`, vault);
      assert.equal(prompt.replacements.length, 1, value);
      const token = prompt.replacements[0].token;
      assert.equal(
        output(`echo ${value}`, vault).text,
        `echo ${token}`,
        `${value} is matched bare`,
      );
    }
    // Ordinary words, lowercase or with one leading capital, with one
    // sentence mark: masked beside the key, never bare.
    for (const value of ['Pay' + 'load', 'lantern' + 's', 'orchard' + '!']) {
      const prompt = typed(`password=${value}`, vault);
      assert.equal(prompt.replacements.length, 1, value);
      const bare = `echo ${value.replace(/!$/u, '')} done`;
      assert.equal(output(bare, vault).text, bare, `${value} is not bare`);
    }
  });
});

test('an apostrophe or a hyphen inside keeps a prompt value matched bare', () => {
  const values = [
    "don't" + 'panic',
    'copper-' + 'lantern',
    'Lantern' + 'Keeper',
  ];
  const entries = new Map(
    values.map((value, i) => [
      `[PASSWORD-f0000${i}]`,
      { type: 'PASSWORD', value, source: 'prompt' },
    ]),
  );
  const text = values.map((value) => `say ${value} now`).join('\n');
  assert.deepEqual(
    exactValueHits(text, { vault: { entries } })
      .map((hit) => hit.value)
      .sort(),
    [...values].sort(),
  );
});

test('a vault entry written before 1.0.0 stops matching bare; known and reported words still do', () => {
  const entries = new Map([
    ['[PASSWORD-aaaaaa]', { type: 'PASSWORD', value: WORD, source: 'prompt' }],
    [
      '[PASSWORD-bbbbbb]',
      { type: 'PASSWORD', value: `${WORD}s`, source: 'detected' },
    ],
    [
      '[PASSWORD-cccccc]',
      { type: 'PASSWORD', value: `${WORD}x`, source: 'known:DB_PASSWORD' },
    ],
    [
      '[PASSWORD-dddddd]',
      { type: 'PASSWORD', value: `${WORD}y`, source: 'reported:2026-09-29' },
    ],
    [
      '[PASSWORD-eeeeee]',
      { type: 'PASSWORD', value: TYPED_PW, source: 'prompt' },
    ],
  ]);
  const vault = { entries };
  const text = `send(${WORD}); send(${WORD}s); send(${WORD}x); send(${WORD}y); ${TYPED_PW}`;
  assert.deepEqual(
    exactValueHits(text, { vault })
      .map((hit) => hit.value)
      .sort(),
    [TYPED_PW, `${WORD}x`, `${WORD}y`].sort(),
  );
});

test('a stored plain-word entry keeps its token after a reload, only where its key is', () => {
  const p = tempProject({ env: false });
  withHome(p.home, () => {
    const first = new Vault(p.dir);
    const token = typed(`password=${WORD}`, first).replacements[0].token;
    first.save();
    const vault = new Vault(p.dir);
    assert.equal(output(`${WORD} shape`, vault).text, `${WORD} shape`);
    assert.equal(output(`password=${WORD}`, vault).text, `password=${token}`);
  });
});
