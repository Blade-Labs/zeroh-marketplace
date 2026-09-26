// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { detectionCatalog } from '../lib/detector.js';

const PLUGIN = fileURLToPath(new URL('..', import.meta.url));
const SKILL = readFileSync(
  path.join(PLUGIN, 'skills', 'about', 'SKILL.md'),
  'utf8',
);
const CATALOG_LINE =
  '!`node "${CLAUDE_SKILL_DIR}/../../bin/zeroh-disclosure.mjs" catalog`';

// T-35: Claude answers questions about ZeroH from the skill and the live
// catalog, so its claims never drift from the rule set.
test('the about skill is a valid skill that injects the live catalog', () => {
  assert.match(SKILL, /^---\nname: about\ndescription: .+\n/u);
  assert.ok(SKILL.includes(CATALOG_LINE));
  // The injected command is exactly the one its allowed-tools permit.
  assert.match(
    SKILL,
    /^allowed-tools: Bash\(node "\$\{CLAUDE_SKILL_DIR\}\/\.\.\/\.\.\/bin\/zeroh-disclosure\.mjs" catalog\), PowerShell\(node "\$\{CLAUDE_SKILL_DIR\}\/\.\.\/\.\.\/bin\/zeroh-disclosure\.mjs" catalog\)$/mu,
  );
  assert.match(SKILL, /Nothing is sent to Blade Labs/u);
});

test('the catalog CLI prints the live rule set, and the documented counts match it', () => {
  const catalog = detectionCatalog();
  const result = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs'), 'catalog', '--json'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.provider_formats, catalog.provider_formats);
  assert.equal(
    printed.providers.reduce((sum, { rules }) => sum + rules.length, 0),
    catalog.provider_formats,
  );
  assert.deepEqual(
    printed.personal_data,
    catalog.personal_data_kinds.map(({ type }) => type).sort(),
  );
  assert.equal(printed.personal_data.length, 33);
  const text = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs'), 'catalog'],
    { encoding: 'utf8' },
  ).stdout;
  assert.match(
    text,
    new RegExp(
      `^Provider key formats: ${catalog.provider_formats} \\(gitleaks v[\\d.]+\\), from ${catalog.providers.length} providers:`,
      'u',
    ),
  );
  // "about N provider ... formats" in the README and CHANGELOG stays within
  // 5% of the live count.
  for (const file of ['README.md', 'CHANGELOG.md']) {
    const body = readFileSync(path.join(PLUGIN, file), 'utf8');
    const claimed = Number(/about (\d+) provider/u.exec(body)?.[1]);
    assert.ok(
      Math.abs(claimed - catalog.provider_formats) <=
        catalog.provider_formats * 0.05,
      `${file} says about ${claimed}, the catalog has ${catalog.provider_formats}`,
    );
  }
});

test('the skill names every credential store ZeroH refuses', async () => {
  const { isSensitivePath } = await import('../lib/secrets.js');
  for (const [file, word] of [
    ['.ssh/id_ed25519', 'SSH keys'],
    ['cert.p12', '.p12'],
    ['vault.kdbx', '.kdbx'],
    ['infra/terraform.tfstate', 'Terraform state'],
    ['.netrc', '.netrc'],
    ['.pgpass', '.pgpass'],
    ['.git-credentials', '.git-credentials'],
    ['.kube/config', 'kubeconfig'],
    ['.aws/credentials', 'AWS credentials'],
    ['.docker/config.json', 'Docker'],
  ]) {
    assert.equal(isSensitivePath(file, '/tmp/project'), true, file);
    assert.ok(SKILL.includes(word), word);
  }
});
