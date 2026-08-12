#!/usr/bin/env node
/**
 * The plugin carries TWO version fields: .claude-plugin/plugin.json (what the Claude Code
 * plugin loader and the marketplace read — the real version, bumped every release) and
 * package.json (npm metadata). Only the first was ever bumped, so package.json sat at
 * 0.18.0 while the plugin shipped 0.29.0 and anything reading npm metadata reported a
 * wrong version. This pin makes the drift a red suite instead of a silent lie.
 *
 * Run: node --test test/version-parity.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('package.json and .claude-plugin/plugin.json agree on the version', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.equal(
    pkg.version,
    plugin.version,
    'bump BOTH files: .claude-plugin/plugin.json is the loader-read truth, package.json is the npm mirror',
  )
})
