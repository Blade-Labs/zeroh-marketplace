// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkPluginIntegrity,
  gitBlobHash,
  installedRoots,
  integrityFixCommand,
  integrityLines,
} from '../lib/plugin-integrity.js';

const hasGit = spawnSync('git', ['--version']).status === 0;

// A Claude Code config dir holding a git-hosted marketplace clone (one
// commit, the plugin under plugins/zeroh-disclosure) and a cached copy of the
// plugin recorded in installed_plugins.json, as `claude plugin install`
// leaves them.
function installedCopy(version = '1.0.0') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-integrity-'));
  const config = path.join(root, 'claude-config');
  const clone = path.join(config, 'plugins', 'marketplaces', 'zeroh');
  const source = path.join(clone, 'plugins', 'zeroh-disclosure');
  const files = {
    '.claude-plugin/plugin.json': `${JSON.stringify({ name: 'zeroh-disclosure', version })}\n`,
    'hooks/run.js': 'export const run = 1;\n',
    'lib/banner.js': 'export const banner = "ZEROHFAKE-banner";\n',
    'README.md': '# ZeroH Disclosure\n',
  };
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(source, relative)), { recursive: true });
    writeFileSync(path.join(source, relative), text);
  }
  symlinkSync('banner.js', path.join(source, 'lib', 'alias.js'));
  mkdirSync(path.join(clone, '.claude-plugin'), { recursive: true });
  writeFileSync(
    path.join(clone, '.claude-plugin', 'marketplace.json'),
    `${JSON.stringify({
      name: 'zeroh',
      plugins: [
        { name: 'zeroh-disclosure', source: './plugins/zeroh-disclosure' },
      ],
    })}\n`,
  );
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-C',
        clone,
        '-c',
        'user.name=ZeroH test',
        '-c',
        'user.email=zeroh-test',
        ...args,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .trim();
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'release');
  const sha = git('rev-parse', 'HEAD');
  const pluginRoot = path.join(
    config,
    'plugins',
    'cache',
    'zeroh',
    'zeroh-disclosure',
    version,
  );
  cpSync(source, pluginRoot, { recursive: true, verbatimSymlinks: true });
  // What Claude Code adds to its copy is not a difference.
  mkdirSync(path.join(pluginRoot, '.in_use'));
  writeFileSync(path.join(pluginRoot, '.orphaned_at'), '1790000000000');
  writeFileSync(
    path.join(config, 'plugins', 'installed_plugins.json'),
    `${JSON.stringify({
      version: 2,
      plugins: {
        'zeroh-disclosure@zeroh': [
          {
            scope: 'user',
            installPath: pluginRoot,
            version,
            gitCommitSha: sha,
          },
        ],
      },
    })}\n`,
  );
  writeFileSync(
    path.join(config, 'plugins', 'known_marketplaces.json'),
    `${JSON.stringify({
      zeroh: {
        source: { source: 'git', url: 'file:///ZEROHFAKE-marketplace' },
        installLocation: clone,
      },
    })}\n`,
  );
  return {
    root,
    config,
    pluginRoot,
    env: { CLAUDE_CONFIG_DIR: config, HOME: path.join(root, 'home') },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('gitBlobHash is git hash-object', { skip: !hasGit }, () => {
  const bytes = Buffer.from('ZEROHFAKE-blob\n');
  const expected = execFileSync('git', ['hash-object', '--stdin'], {
    input: bytes,
  })
    .toString()
    .trim();
  assert.equal(gitBlobHash(bytes), expected);
});

test(
  'a cached copy identical to the recorded release is ok',
  { skip: !hasGit },
  () => {
    const copy = installedCopy();
    try {
      const result = checkPluginIntegrity({
        pluginRoot: copy.pluginRoot,
        env: copy.env,
      });
      assert.equal(result.state, 'ok');
      assert.equal(result.id, 'zeroh-disclosure@zeroh');
      assert.equal(result.checked, 5);
      assert.deepEqual(integrityLines(result), []);
    } finally {
      copy.cleanup();
    }
  },
);

// Git for Windows checks text files out with CRLF (core.autocrlf=true), and
// Claude Code copies the plugin from that clone.
test(
  'a copy with CRLF line ends from a Windows clone is ok; a changed line is still stale',
  { skip: !hasGit },
  () => {
    const copy = installedCopy();
    try {
      for (const relative of ['README.md', 'hooks/run.js']) {
        const file = path.join(copy.pluginRoot, ...relative.split('/'));
        writeFileSync(
          file,
          readFileSync(file, 'utf8').replaceAll('\n', '\r\n'),
        );
      }
      assert.equal(
        checkPluginIntegrity({ pluginRoot: copy.pluginRoot, env: copy.env })
          .state,
        'ok',
      );
      writeFileSync(
        path.join(copy.pluginRoot, 'hooks', 'run.js'),
        'export const run = 2;\r\n',
      );
      const result = checkPluginIntegrity({
        pluginRoot: copy.pluginRoot,
        env: copy.env,
      });
      assert.equal(result.state, 'stale');
      assert.deepEqual(result.changed, ['hooks/run.js']);
    } finally {
      copy.cleanup();
    }
  },
);

// The owner's Mac case: a folder for the new version left by an earlier
// build, which `claude plugin update` keeps as it is.
test(
  'a folder left by an earlier build is stale, with the fix',
  { skip: !hasGit },
  () => {
    const copy = installedCopy();
    try {
      writeFileSync(
        path.join(copy.pluginRoot, 'lib', 'banner.js'),
        'export const banner = "ZEROHFAKE-old-banner";\n',
      );
      rmSync(path.join(copy.pluginRoot, 'README.md'));
      writeFileSync(path.join(copy.pluginRoot, 'lib', 'old-only.js'), '\n');
      const result = checkPluginIntegrity({
        pluginRoot: copy.pluginRoot,
        env: copy.env,
      });
      assert.equal(result.state, 'stale');
      assert.deepEqual(result.changed, ['lib/banner.js']);
      assert.deepEqual(result.missing, ['README.md']);
      assert.deepEqual(result.extra, ['lib/old-only.js']);
      const lines = integrityLines(result, 'linux');
      assert.match(lines[0], /not the 1\.0\.0 release it installed/u);
      assert.match(lines[0], /1 changed \(lib\/banner\.js\)/u);
      // The check resolves links (the copy must really sit in the cache), so
      // the fix names the real folder: /private/var/… on macOS.
      assert.equal(
        integrityFixCommand(result, 'linux'),
        `rm -rf '${realpathSync(copy.pluginRoot)}' && claude plugin install zeroh-disclosure@zeroh`,
      );
      assert.ok(lines[1].endsWith(integrityFixCommand(result, 'linux')));
      assert.match(
        integrityFixCommand(result, 'win32'),
        /^Remove-Item -Recurse -Force '.+'; claude plugin install zeroh-disclosure@zeroh$/u,
      );
    } finally {
      copy.cleanup();
    }
  },
);

test(
  'a copy whose plugin.json names another version is stale',
  { skip: !hasGit },
  () => {
    const copy = installedCopy();
    try {
      writeFileSync(
        path.join(copy.pluginRoot, '.claude-plugin', 'plugin.json'),
        `${JSON.stringify({ name: 'zeroh-disclosure', version: '1.0.0-rc.2' })}\n`,
      );
      const result = checkPluginIntegrity({
        pluginRoot: copy.pluginRoot,
        env: copy.env,
      });
      assert.equal(result.state, 'stale');
      assert.match(
        integrityLines(result, 'linux')[0],
        /plugin\.json says 1\.0\.0-rc\.2, Claude Code installed 1\.0\.0/u,
      );
    } finally {
      copy.cleanup();
    }
  },
);

// Never a false alarm: whatever can't be compared is unverifiable.
test(
  'what cannot be compared is unverifiable, never stale',
  { skip: !hasGit },
  () => {
    const copy = installedCopy();
    try {
      // A --plugin-dir or local-directory copy, outside the cache.
      assert.equal(
        checkPluginIntegrity({ pluginRoot: copy.root, env: copy.env }).reason,
        'not-a-cached-copy',
      );
      // The recorded commit is gone from the clone (it moved on).
      const failingGit = () => {
        throw new Error('fatal: bad object');
      };
      assert.equal(
        checkPluginIntegrity({
          pluginRoot: copy.pluginRoot,
          env: copy.env,
          git: failingGit,
        }).reason,
        'commit-not-in-clone',
      );
      // No record for this folder.
      writeFileSync(
        path.join(copy.config, 'plugins', 'installed_plugins.json'),
        '{"version":2,"plugins":{}}\n',
      );
      const result = checkPluginIntegrity({
        pluginRoot: copy.pluginRoot,
        env: copy.env,
      });
      assert.equal(result.state, 'unverifiable');
      assert.equal(result.reason, 'no-install-record');
      assert.deepEqual(integrityLines(result), []);
    } finally {
      copy.cleanup();
    }
  },
);
