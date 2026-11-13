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
import { Vault } from '../../packages/zeroh-disclosure-core/vault.js';
import {
  exactValueHits,
  scrub,
} from '../../packages/shell-analysis/secrets.js';
import { matchers } from '../../packages/shell-analysis/secrets/rewrite.js';
import { tempProject } from '../helpers.mjs';

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

test('registration persists matchScope and explicit scope controls bare matching', () => {
  const p = tempProject({ env: false });
  withHome(p.home, () => {
    const vault = new Vault(p.dir);
    const value = 'ZEROHFAKE' + '-scope9';
    const token = vault.tokenFor('PASSWORD', value, 'detected', {
      matchScope: 'in-context',
    });
    assert.equal(vault.entryOf(token).matchScope, 'in-context');
    assert.deepEqual(exactValueHits(`echo ${value}`, { vault }), []);
    assert.ok(scrub(`password="${value}"`, { vault }).replacements.length);
    vault.save();
    const loaded = new Vault(p.dir);
    assert.equal(loaded.entryOf(token).matchScope, 'in-context');
    const bare = loaded.tokenFor('PASSWORD', 'ZEROHFAKE-bare9', 'detected', {
      matchScope: 'bare',
    });
    assert.equal(loaded.entryOf(bare).matchScope, 'bare');
    assert.equal(
      exactValueHits('echo ZEROHFAKE-bare9', { vault: loaded }).length,
      1,
    );
    assert.throws(
      () =>
        loaded.tokenFor('PASSWORD', 'ZEROHFAKE-invalid9', 'detected', {
          matchScope: 'invalid',
        }),
      TypeError,
    );
  });
});
test('legacy entries without matchScope retain the old compatibility predicate', () => {
  const p = tempProject({ env: false });
  withHome(p.home, () => {
    const vault = new Vault(p.dir);
    const token = vault.tokenFor('PASSWORD', WORD, 'prompt');
    delete vault.entries.get(token).matchScope;
    assert.deepEqual(exactValueHits(`echo ${WORD}`, { vault }), []);
    const known = vault.tokenFor('PASSWORD', 'lantern', 'known:DB_PASSWORD');
    delete vault.entries.get(known).matchScope;
    assert.equal(exactValueHits('echo lantern', { vault }).length, 1);
    vault.save();
    const reloaded = new Vault(p.dir);
    assert.equal(reloaded.entryOf(token).matchScope, undefined);
    assert.deepEqual(exactValueHits(`echo ${WORD}`, { vault: reloaded }), []);
  });
});

// Phase 789.1: receipt.html re-masks every stored label of every turn at each
// Stop, through scrub() with no `known` list. A fresh default `known` per call
// missed the per-vault memo, so each label rebuilt the matcher of the whole
// vault: 27 s at 1,000 turns and a timed-out Stop (no receipt) at 3,000.
test('scrub calls without a known list share one vault matcher, which still masks values added later', () => {
  const p = tempProject({ env: false });
  withHome(p.home, () => {
    const vault = new Vault(p.dir);
    const first = 'quokka-' + '7319';
    const second = 'marmot-' + '8842';
    const firstToken = vault.tokenFor('PASSWORD', first, 'detected', {
      matchScope: 'bare',
    });
    assert.equal(
      output(`note ${first} end`, vault).text,
      `note ${firstToken} end`,
    );
    const matcher = matchers.get(vault)?.matcher;
    assert.ok(matcher, 'the first call builds the vault matcher');
    output('another label', vault);
    assert.equal(
      matchers.get(vault).matcher,
      matcher,
      'a second call without `known` reuses the vault matcher',
    );
    const secondToken = vault.tokenFor('PASSWORD', second, 'detected', {
      matchScope: 'bare',
    });
    assert.equal(
      output(`${second} and ${first}`, vault).text,
      `${secondToken} and ${firstToken}`,
      'a value recorded after the matcher was built is still masked',
    );
    assert.equal(matchers.get(vault).matcher, matcher);
  });
});

// Phase 789.1 review: Vault.touch and refreshKnown replace an entry object in
// place when its source changes. A matcher shared across calls without a
// known list must see that, or an upgraded value would pass unmasked.
test('an entry whose source is upgraded in place to reported is matched by the next call without a known list', () => {
  const token = '[PASSWORD-ffffff]';
  const entries = new Map([
    [token, { type: 'PASSWORD', value: WORD, source: 'detected' }],
  ]);
  const vault = { entries };
  const hits = () =>
    exactValueHits(`send(${WORD})`, { vault }).map((h) => h.value);
  assert.deepEqual(hits(), []);
  entries.set(token, { ...entries.get(token), source: 'reported:2026-11-11' });
  assert.deepEqual(hits(), [WORD]);
  entries.set(token, { ...entries.get(token), source: 'detected' });
  assert.deepEqual(hits(), [], 'a downgrade stops the bare match again');
});

// Architect review, 2026-11-11: the matcher keeps the first candidate for a
// value. When an earlier entry becomes exact-matchable, its unbounded encoded
// form must win over a later bounded entry with the same text, as in a fresh
// build, or the encoded value embedded in other text passes unmasked.
test('a promoted earlier entry masks as a freshly built matcher does', () => {
  const plain = 'quokka-' + '7319';
  const encoded = Buffer.from(plain, 'utf8').toString('base64');
  const earlier = '[PASSWORD-aaaaaa]';
  const entries = new Map([
    [
      earlier,
      {
        type: 'PASSWORD',
        value: plain,
        source: 'detected',
        matchScope: 'in-context',
      },
    ],
    [
      '[PASSWORD-bbbbbb]',
      { type: 'PASSWORD', value: encoded, source: 'detected' },
    ],
  ]);
  const vault = { entries };
  const text = `blob=x${encoded}x`;
  const hits = () => exactValueHits(text, { vault }).map((h) => h.value);
  assert.deepEqual(hits(), [], 'a bounded value is not matched inside a word');
  entries.set(earlier, { ...entries.get(earlier), matchScope: 'bare' });
  const warmed = hits();
  matchers.delete(vault);
  assert.deepEqual(warmed, hits(), 'warmed and fresh matchers agree');
  assert.deepEqual(warmed, [encoded]);
});
