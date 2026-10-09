// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFileSync } from 'node:fs';
import { Vault } from '../../packages/zeroh-disclosure-core/vault.js';
import {
  FAKE_STRIPE,
  FAKE_WEBHOOK,
  PLUGIN,
  runHook,
  tempProject,
} from '../helpers.mjs';

const pluginDir = process.env.ZEROH_47D_PLUGIN || PLUGIN;
const baseline = Boolean(process.env.ZEROH_47D_BASELINE);
const rows = [
  ['empty password', (t) => `curl https://api.stripe.com -u "${t}:"`],
  ['user password', (t) => `curl https://api.stripe.com -u "user:${t}"`],
  [
    'admin password long flag',
    (t) => `curl https://api.stripe.com --user "admin:${t}"`,
  ],
  ['two tokens', (t, t2) => `curl https://api.stripe.com -u "${t}:${t2}"`],
  [
    'real password',
    (t) => `curl https://api.stripe.com -u "${t}:ZEROHFAKE9xQ!7b"`,
  ],
  ['URL user password', (t) => `curl "https://user:${t}@example.com"`],
  ['URL empty password', (t) => `curl "https://${t}:@example.com"`],
  ['URL two tokens', (t, t2) => `curl "https://${t}:${t2}@example.com"`],
  ['password semicolon', (t) => `password=${t};`],
  ['Basic equals', (t) => `Authorization: Basic ${t}=`],
  ['Bearer', (t) => `Authorization: Bearer ${t}`],
  ['JSON', (t) => `{"password":"${t}"}`],
  ['KEY trailing quote', (t) => `API_KEY=${t}"`],
  ['postgres connection', (t) => `postgres://user:${t}@example.com/db`],
  ['redis connection', (t) => `redis://user:${t}@example.com/0`],
  ['single quotes', (t) => `echo '${t}'`],
  ['double quotes', (t) => `echo "${t}"`],
  ['brackets', (t) => `echo "[${t}]"`],
  ['adjacent', (t, t2) => `echo "${t}${t2}"`],
  ['YAML', (t) => `password: "${t}"`],
  ['unquoted admin', (t) => `curl https://api.stripe.com -u admin:${t}`],
  [
    'git oauth URL',
    (t) => `git clone "https://oauth2:${t}@example.com/repo.git"`,
  ],
  ['mysql', (t) => `mysql -p${t}`],
  [
    'docker login',
    (t) => `docker login example.com --username admin --password "${t}"`,
  ],
  ['inline env', (t) => `API_KEY="${t}" curl https://example.com`],
  ['URL admin password host', (t) => `curl "https://admin:${t}@example.com"`],
];

for (const family of ['Z', 'G']) {
  test(`reviewer probe matrix ${family}`, () => {
    const p = tempProject({ env: false });
    const options = { project: p, pluginDir };
    const mint = (raw) => {
      const result = runHook(
        'post-tool-use',
        {
          tool_name: 'Bash',
          tool_input: { command: 'cat fake.txt' },
          tool_response: { stdout: raw, stderr: '' },
        },
        options,
      );
      const token = result.json?.hookSpecificOutput?.updatedToolOutput?.stdout;
      assert.ok(
        typeof token === 'string' && token.startsWith('['),
        'fake value minted',
      );
      return token;
    };
    const minted = [mint(FAKE_STRIPE), mint(FAKE_WEBHOOK)];
    const tokens =
      family === 'Z'
        ? minted
        : [
            `<API_KEY_${'0123456789abcdef'}>`,
            `<API_KEY_${'fedcba9876543210'}>`,
          ];
    for (const [label, build] of rows) {
      const command = build(...tokens);
      const pre = runHook(
        'pre-tool-use',
        {
          session_id: 'ZEROHFAKE-probes',
          tool_use_id: label.replaceAll(' ', '-'),
          tool_name: 'Bash',
          tool_input: { command },
        },
        options,
      );
      const post = runHook(
        'post-tool-use',
        {
          tool_name: 'Bash',
          tool_input: { command: 'cat fake.txt' },
          tool_response: { stdout: command, stderr: '' },
        },
        options,
      );
      assert.equal(pre.code, 0, `${label}: pre completes`);
      assert.equal(post.code, 0, `${label}: post completes`);
      const output = post.json?.hookSpecificOutput?.updatedToolOutput?.stdout;
      const result = {
        family,
        label,
        pre:
          pre.json?.hookSpecificOutput?.permissionDecision === 'deny'
            ? 'deny'
            : pre.json?.hookSpecificOutput?.updatedInput
              ? 'restore'
              : 'allow',
        post: output && output !== command ? 'mints' : 'unchanged',
      };
      if (process.env.ZEROH_47D_LOG)
        appendFileSync(
          process.env.ZEROH_47D_LOG,
          JSON.stringify(result) + '\n',
        );
      if (
        family === 'Z' &&
        ['user password', 'admin password long flag'].includes(label)
      ) {
        assert.equal(result.pre, 'restore', label);
        assert.equal(result.post, 'unchanged', label);
      }
      if (
        !baseline &&
        [
          'empty password',
          'two tokens',
          'user password',
          'admin password long flag',
        ].includes(label)
      )
        assert.equal(result.post, 'unchanged', `${label}: no new token`);
      if (!baseline && label === 'real password')
        assert.equal(result.pre, 'deny', 'real password stays protected');
    }
  });
}

for (const shape of ['user password', 'admin password', 'two tokens']) {
  test(`PostToolUse mints no vault entries: ${shape}`, () => {
    const p = tempProject({ env: false });
    const options = { project: p, pluginDir };
    const output = (stdout) =>
      runHook(
        'post-tool-use',
        {
          tool_name: 'Bash',
          tool_input: { command: 'cat fake.txt' },
          tool_response: { stdout, stderr: '' },
        },
        options,
      );
    const first =
      output(FAKE_STRIPE).json.hookSpecificOutput.updatedToolOutput.stdout;
    const second =
      output(FAKE_WEBHOOK).json.hookSpecificOutput.updatedToolOutput.stdout;
    const entries = () =>
      new Vault(p.dir, {
        env: {
          ...process.env,
          ZEROH_HOME: p.home,
          ZEROH_CREDENTIAL_HOME: p.home,
        },
      }).entries.size;
    assert.equal(entries(), 2, 'only fake setup entries');
    const command =
      shape === 'user password'
        ? `curl https://example.com -u "user:${first}"`
        : shape === 'admin password'
          ? `curl https://example.com --user "admin:${first}"`
          : `curl https://example.com -u "${first}:${second}"`;
    const result = output(command);
    assert.equal(result.code, 0);
    assert.equal(entries(), 2, 'no username, separator or colon entry minted');
    const rewritten =
      result.json?.hookSpecificOutput?.updatedToolOutput?.stdout;
    assert.ok(!rewritten || rewritten === command, 'output bytes preserved');
  });
}
