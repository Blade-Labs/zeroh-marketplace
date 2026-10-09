// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MIXED_TOKEN_REQUEST,
  TWO_TOKEN_FAMILIES,
} from '../../vendor/sensitive-data-detectors/src/fixtures/two-token-families.js';
import {
  detectSensitiveData,
  detectEntropyWarnings,
} from '../../packages/zeroh-disclosure-core/detector.js';
import {
  isGatewayToken,
  GATEWAY_TOKEN_PATTERN,
  GATEWAY_TOKEN_PATTERN_VERSION,
  nameMentionedTokens,
} from '../../packages/zeroh-disclosure-core/token-pattern.js';
import * as vendorTokens from '../../vendor/sensitive-data-detectors/src/masked-tokens.js';
import { readFileSync } from 'node:fs';
import { Vault } from '../../packages/zeroh-disclosure-core/vault.js';
import { knownValueMasker } from '../../packages/zeroh-disclosure-core/restorable.js';
import {
  scrub,
  restore,
  exactValueHits,
} from '../../packages/shell-analysis/secrets/rewrite.js';
import { analyzeShell } from '../../packages/shell-analysis/scan.js';
import { shellDestinations } from '../../packages/shell-analysis/shell-destinations.js';
import {
  commandParts,
  referenceOnly,
} from '../../packages/shell-analysis/shell-references.js';
import { scrubBody } from '../../packages/local-proxy/scrub.js';
import { runHook, tempProject } from '../helpers.mjs';

test('synced two-family fixture masks only raw values in every channel', () => {
  const p = tempProject({ env: false });
  const vault = new Vault(p.dir, {
    env: { ...process.env, ZEROH_HOME: p.home },
  });
  for (const channel of ['prose', 'file', 'shell', 'tool']) {
    const findings = detectSensitiveData(MIXED_TOKEN_REQUEST, {
      channel,
      context: 'mixed',
      region: null,
    });
    assert.deepEqual(
      findings.map((f) => MIXED_TOKEN_REQUEST.slice(f.start, f.end)),
      TWO_TOKEN_FAMILIES.raw,
    );
    const result = scrub(MIXED_TOKEN_REQUEST, { vault, channel });
    assert.equal(result.replacements.length, 2);
    for (const gateway of TWO_TOKEN_FAMILIES.gateway)
      assert.ok(result.text.includes(gateway));
  }
  const request = {
    messages: [{ role: 'user', content: MIXED_TOKEN_REQUEST }],
  };
  const provider = scrubBody(request, { vault, root: p.dir, known: [] });
  for (const gateway of TWO_TOKEN_FAMILIES.gateway)
    assert.ok(JSON.stringify(provider).includes(gateway));
});

test('gateway recognition is case sensitive and bounded; brackets alone do not exempt a value', () => {
  for (const suffix of ['a'.repeat(16), 'a'.repeat(32), 'a'.repeat(64)])
    assert.equal(isGatewayToken(`<EMAIL_ADDRESS_${suffix}>`), true);
  for (const value of [
    '<EMAIL_>',
    '<EMAIL_a>',
    `<EMAIL_${'a'.repeat(40)}>`,
    `<EMAIL_${'a'.repeat(65)}>`,
    '<EMAIL_ABCD>',
    '<email_abcd>',
    '<1EMAIL_abcd>',
    '<EMAIL_ab.cd>',
    '<EMAIL_abcd@example.com>',
  ])
    assert.equal(isGatewayToken(value), false);
  for (const raw of TWO_TOKEN_FAMILIES.raw)
    assert.ok(
      detectSensitiveData(`<${raw}>`).length > 0,
      'raw bracketed value detected',
    );
  assert.ok(
    detectSensitiveData('password="<ZEROHFAKEstrongPassword47!>"', {
      channel: 'file',
      context: 'dotenv',
    }).length > 0,
  );
});

test('gateway tokens are never resolved or named; unrelated known values leave them unchanged', () => {
  const text = TWO_TOKEN_FAMILIES.gateway.join(' ');
  const vault = {
    entryOf() {
      assert.fail('gateway must never ask vault');
    },
  };
  assert.deepEqual(restore(text, vault), { text, restored: [] });
  assert.deepEqual(nameMentionedTokens(`the token ${text}`), {
    text: `the token ${text}`,
    changed: false,
  });
  const known = [
    { name: 'API_KEY', type: 'API_KEY', value: 'ZEROHFAKE-unrelated47' },
  ];
  const p = tempProject({ env: false });
  const live = new Vault(p.dir, {
    env: { ...process.env, ZEROH_HOME: p.home },
  });
  assert.deepEqual(exactValueHits(text, { vault: live, known }), []);
  assert.equal(scrub(text, { vault: live, known }).text, text);
  const fallback = knownValueMasker([
    { ...known[0], token: '[API_KEY-abcdef]' },
  ]);
  assert.equal(fallback.replaceText(text), text);
});

test('a 1.0 fixture vault restores its ZeroH token in a resumed mixed session', () => {
  const p = tempProject({ env: false });
  const env = { ...process.env, ZEROH_HOME: p.home };
  const vault = new Vault(p.dir, { env });
  vault.register(
    TWO_TOKEN_FAMILIES.zeroh[0],
    'EMAIL',
    TWO_TOKEN_FAMILIES.raw[0],
    'prompt',
  );
  vault.save();
  const resumed = new Vault(p.dir, { env });
  const mixed = [
    TWO_TOKEN_FAMILIES.zeroh[0],
    ...TWO_TOKEN_FAMILIES.gateway,
  ].join(' ');
  const result = restore(mixed, resumed);
  assert.equal(result.restored.length, 1);
  assert.equal(
    result.text,
    [TWO_TOKEN_FAMILIES.raw[0], ...TWO_TOKEN_FAMILIES.gateway].join(' '),
  );
});

// Shell syntax is authoritative; gateway arguments must be literal strings.
for (const shell of ['bash', 'powershell']) {
  test(`gateway tokens are opaque destination-gate operands in ${shell}`, () => {
    for (const token of TWO_TOKEN_FAMILIES.gateway) {
      for (const command of [
        `echo '${token}'`,
        `echo "${token}"`,
        `curl -H "X-Masked: ${token}" https://example.com`,
      ]) {
        const parsed = analyzeShell(command, shell);
        assert.equal(parsed.ok, true);
        assert.ok(parsed.commands.every((c) => c.redirects.length === 0));
        assert.ok(
          parsed.commands.some((c) =>
            c.words.some((w) => w.value.includes(token)),
          ),
        );
        const destinations = shellDestinations(command, shell);
        assert.ok(!JSON.stringify(destinations).includes(token));
        const parts = commandParts(command, shell);
        assert.equal(
          referenceOnly(
            command,
            command.indexOf(token),
            command.indexOf(token) + token.length,
            shell,
            parts,
          ),
          false,
        );
        assert.equal(
          restore(command, {
            entryOf() {
              assert.fail('no gateway lookup');
            },
          }).text,
          command,
        );
      }
    }
  });
}

test('display hook leaves gateway tokens byte-identical', () => {
  const p = tempProject({ env: false });
  const text = `the token ${TWO_TOKEN_FAMILIES.gateway.join(' ')}`;
  const result = runHook(
    'message-display',
    { delta: text, final: true },
    { project: p },
  );
  assert.ok(
    !result.json ||
      !result.json.hookSpecificOutput?.displayContent ||
      result.json.hookSpecificOutput.displayContent === text,
  );
});

test('gateway placeholders produce no entropy suggestion or prompt observation', () => {
  const p = tempProject({ env: false });
  const text = TWO_TOKEN_FAMILIES.gateway.join(' ');
  assert.deepEqual(detectEntropyWarnings(text), []);
  const prompt = runHook(
    'user-prompt-submit',
    { prompt: text },
    { project: p },
  );
  assert.equal(prompt.code, 0);
  assert.equal(prompt.json, null);
});

test('gateway tokens survive fragmented display and all tool output surfaces', () => {
  const p = tempProject({ env: false });
  const token = TWO_TOKEN_FAMILIES.gateway[0];
  for (const split of [1, 3, token.length - 1]) {
    let shown = '';
    for (const [index, delta] of [
      token.slice(0, split),
      token.slice(split),
    ].entries()) {
      const result = runHook(
        'message-display',
        {
          delta,
          final: index === 1,
          index,
          message_id: `ZEROHFAKE-stream-${split}`,
        },
        { project: p },
      );
      assert.equal(result.code, 0);
      shown += result.json?.hookSpecificOutput?.displayContent ?? delta;
    }
    assert.equal(shown, token);
  }
  for (const event of [
    {
      tool_name: 'Read',
      tool_input: { file_path: `${p.dir}/fake.txt` },
      tool_response: {
        type: 'text',
        file: { filePath: `${p.dir}/fake.txt`, content: MIXED_TOKEN_REQUEST },
      },
    },
    {
      tool_name: 'Bash',
      tool_input: { command: 'printf ZEROHFAKE' },
      tool_response: { stdout: MIXED_TOKEN_REQUEST, stderr: '' },
    },
    {
      tool_name: 'mcp__fake__result',
      tool_input: {},
      tool_response: { content: [{ type: 'text', text: MIXED_TOKEN_REQUEST }] },
    },
  ]) {
    const result = runHook('post-tool-use', event, { project: p });
    assert.equal(result.code, 0);
    const output = JSON.stringify(
      result.json?.hookSpecificOutput?.updatedMCPToolOutput ??
        result.json?.hookSpecificOutput?.updatedToolOutput ??
        result.json,
    );
    assert.ok(output);
    for (const gateway of TWO_TOKEN_FAMILIES.gateway)
      assert.ok(output.includes(gateway));
    for (const raw of TWO_TOKEN_FAMILIES.raw) assert.ok(!output.includes(raw));
  }
});

test('load-time gateway pattern is import-free and matches the vendored version', () => {
  const source = readFileSync(
    new URL(
      '../../packages/zeroh-disclosure-core/token-pattern.js',
      import.meta.url,
    ),
    'utf8',
  );
  assert.doesNotMatch(source, /\bimport\b\s*(?:\(|[{*'"\w])/u);
  assert.equal(GATEWAY_TOKEN_PATTERN, vendorTokens.GATEWAY_TOKEN_PATTERN);
  assert.equal(
    GATEWAY_TOKEN_PATTERN_VERSION,
    vendorTokens.GATEWAY_TOKEN_PATTERN_VERSION,
  );
});
