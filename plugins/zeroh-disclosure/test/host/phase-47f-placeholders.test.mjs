// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGIN, runHook, tempProject } from '../helpers.mjs';
import { MONOREPO, monorepoOnly } from '../monorepo.mjs';

if (!MONOREPO) {
  test(
    'ruling 9 hooks: shared placeholder corpus',
    {
      skip: monorepoOnly(
        'packages/sensitive-data-detectors/src/fixtures/phase-47f.js',
      ),
    },
    () => {},
  );
} else {
  const { ANGLE_VALUE_SHAPES, RULING_9_CASES } =
    await import('../../../../../../packages/sensitive-data-detectors/src/fixtures/phase-47f.js');
  const { isDocumentationPlaceholder } =
    await import('../../../../../../packages/sensitive-data-detectors/src/documentation-placeholder.js');

  const pluginDir = process.env.ZEROH_47F_PLUGIN || PLUGIN;
  const baseline = Boolean(process.env.ZEROH_47F_BASELINE);
  const baselines = baseline
    ? null
    : JSON.parse(
        readFileSync(new URL('./phase-47h-baselines.json', import.meta.url)),
      );
  const { loadKnownSecrets } = await import(
    pathToFileURL(
      path.join(pluginDir, 'packages/shell-analysis/secrets/detect.js'),
    )
  );
  const { Vault } = await import(
    pathToFileURL(
      path.join(pluginDir, 'packages/zeroh-disclosure-core/vault.js'),
    )
  );
  const log = (row) => {
    if (process.env.ZEROH_47F_LOG)
      appendFileSync(process.env.ZEROH_47F_LOG, JSON.stringify(row) + '\n');
  };
  // Vaults use random keys. Preserve token type and position while normalizing
  // only the six-character keyed suffix before comparing exact rewritten bytes.
  const normalize = (text) =>
    text.replace(/\[([A-Z_]+)-[0-9a-f]{6}\]/gu, '[$1-MASK]');
  const digest = (text) =>
    createHash('sha256').update(normalize(text)).digest('hex');

  for (const [label, value] of RULING_9_CASES) {
    for (const [shape, build] of ANGLE_VALUE_SHAPES) {
      test(`ruling 9 hooks: ${label}: ${shape}`, () => {
        const project = tempProject({ env: false });
        const options = { project, pluginDir };
        const command = build(value);
        const pre = runHook(
          'pre-tool-use',
          {
            session_id: 'ZEROHFAKE-47h',
            tool_use_id: 'ZEROHFAKE-probe',
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
        assert.equal(pre.code, 0, 'PreToolUse completes');
        assert.equal(post.code, 0, 'PostToolUse completes');
        const output =
          post.json?.hookSpecificOutput?.updatedToolOutput?.stdout ?? command;
        const input =
          pre.json?.hookSpecificOutput?.updatedInput?.command ?? command;
        const row = {
          label,
          shape,
          pre:
            pre.json?.hookSpecificOutput?.permissionDecision === 'deny'
              ? 'deny'
              : pre.json?.hookSpecificOutput?.updatedInput
                ? 'restore'
                : 'allow',
          post: output !== command ? 'mints' : 'unchanged',
          exposed: output.includes(value),
          fragmentsExposed: value
            .slice(1, -1)
            .split(/[. ]/u)
            .some((fragment) => normalize(output).includes(fragment)),
          inputHash: digest(input),
          outputHash: digest(output),
          entries: new Vault(project.dir, {
            env: { ...process.env, ZEROH_HOME: project.home },
          }).entries.size,
        };
        log(row);
        if (baseline) return;
        const exempt =
          isDocumentationPlaceholder(value) &&
          ['URL password', 'unquoted credential'].includes(shape);
        assert.deepEqual(
          row,
          baselines[`${label}|${shape}`][exempt ? 'base' : 'head'],
          `permission, rewritten bytes, exposure and vault entries equal ${exempt ? 'base' : 'HEAD'}`,
        );
      });
    }
    test(`ruling 9 hooks: ${label}: environment discovery`, () => {
      const project = tempProject({ env: false });
      const known = loadKnownSecrets(
        project.dir,
        {
          ZEROH_CREDENTIAL_HOME: project.home,
          API_KEY: value,
          PASSWORD: value,
        },
        { home: project.home },
      );
      const row = {
        label,
        shape: 'environment discovery',
        known: known.filter((k) => k.value === value).length,
      };
      log(row);
      if (baseline) return;
      assert.deepEqual(row, baselines[`${label}|${row.shape}`].head);
      if (!row.known) return;
      const post = runHook(
        'post-tool-use',
        {
          tool_name: 'Bash',
          tool_input: { command: 'cat fake.txt' },
          tool_response: { stdout: value, stderr: '' },
        },
        { project, pluginDir, extraEnv: { API_KEY: value, PASSWORD: value } },
      );
      assert.equal(post.code, 0);
      const output = post.json?.hookSpecificOutput?.updatedToolOutput?.stdout;
      assert.ok(
        output && !output.includes(value),
        'discovered known value masked',
      );
    });
  }
}
