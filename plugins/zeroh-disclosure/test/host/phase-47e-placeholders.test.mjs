// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGIN, runHook, tempProject } from '../helpers.mjs';

const pluginDir = process.env.ZEROH_47E_PLUGIN || PLUGIN;
const { Vault } = await import(
  pathToFileURL(path.join(pluginDir, 'packages/zeroh-disclosure-core/vault.js'))
);
const { scrub } = await import(
  pathToFileURL(
    path.join(pluginDir, 'packages/shell-analysis/secrets/rewrite.js'),
  )
);
test('known and vault documentation-shaped values override the exemption', () => {
  for (const source of ['known', 'vault']) {
    for (const raw of [
      '<your-api-key>',
      '<pass>',
      '<changeme>',
      'ZEROHFAKE_doc_47',
    ]) {
      for (const build of [
        (v) => `password="${v}"`,
        (v) => `curl "https://user:${v}@example.com"`,
        (v) => `curl -u user:${v} https://example.com`,
        (v) => `curl -u "user:${v}" https://example.com`,
        (v) => `password="<${v}>"`,
        (v) => `curl "https://user:<${v}>@example.com"`,
        (v) => `password="<prefix-${v}-suffix>"`,
        (v) => `password="${v}<api-key>"`,
      ]) {
        const project = tempProject({ env: false });
        const env = { ...process.env, ZEROH_HOME: project.home };
        if (source === 'vault') {
          const vault = new Vault(project.dir, { env });
          vault.tokenFor('SECRET', raw, 'known:SECRET');
          vault.save();
        }
        const command = build(raw);
        const vault = new Vault(project.dir, { env });
        const result = scrub(command, {
          vault,
          known:
            source === 'known'
              ? [{ name: 'SECRET', type: 'SECRET', value: raw }]
              : [],
        });
        assert.ok(result.replacements.length > 0, 'known/vault value matched');
        assert.ok(!result.text.includes(raw), 'known/vault value masked');
        if (source === 'known') continue;
        const options = { project, pluginDir };
        const post = runHook(
          'post-tool-use',
          {
            tool_name: 'Bash',
            tool_input: { command: 'cat fake.txt' },
            tool_response: { stdout: command, stderr: '' },
          },
          options,
        );
        assert.equal(post.code, 0);
        const output = post.json?.hookSpecificOutput?.updatedToolOutput?.stdout;
        assert.ok(
          output && !output.includes(raw),
          'known value masked even within documentation',
        );
      }
    }
  }
});
