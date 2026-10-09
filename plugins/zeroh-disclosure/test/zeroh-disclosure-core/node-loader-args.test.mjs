// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { PLUGIN } from '../helpers.mjs';
import {
  scanNodeLoaderArguments,
  unsafeNodeLoaderArguments,
} from '../tools/node-loader-args.mjs';

test('all test and tool loader arguments use file URLs or bare specifiers', () => {
  const failures = ['test', 'scripts'].flatMap((directory) =>
    scanNodeLoaderArguments(path.join(PLUGIN, directory)),
  );
  assert.deepEqual(failures, []);
});

test('static loader guard rejects raw paths, unresolved bindings and unsafe branches', () => {
  for (const source of [
    "spawn(node, ['--import', path.join(dir, 'preload.mjs')]);",
    "const preload = path.join(dir, 'preload.mjs'); spawn(node, ['--loader', preload]);",
    "const preload = 'D:\\\\fake\\\\preload.mjs'; spawn(node, ['--require', preload]);",
    "const preload = '/tmp/fake.mjs'; spawn(node, ['--import', preload]);",
    "const preload = './preload.mjs'; spawn(node, ['--import', preload]);",
    "spawn(node, ['--loader', missing]);",
    "const url = pathToFileURL(file).href; spawn(node, ['--import', ok ? url : file]);",
    "spawn(node, ['--import=' + file]);",
    'const env = { NODE_OPTIONS: `--import=${file}` };',
    'const env = { NODE_OPTIONS: `--require ${JSON.stringify(file)}` };',
    "const good = pathToFileURL(file).href; const preload = file; spawn(node, ['--import', preload]);",
    "const a = b; const b = a; spawn(node, ['--import', a]);",
    "spawn(node, ['--import', pathToFileURL(file).href + file]);",
    "spawn(node, ['--import=file:///D:/fake/' + file]);",
    "let preload = pathToFileURL(file).href; preload = raw; spawn(node, ['--import', preload]);",
    "spawn(node, ['--import', new URL('file:///D:/fake/p.mjs').href ? raw : new URL('file:///D:/fake/p.mjs').href]);",
  ]) {
    assert.equal(unsafeNodeLoaderArguments(source).length, 1, source);
  }
});

test('static loader guard accepts URL construction, aliases, bare specifiers and NODE_OPTIONS', () => {
  for (const source of [
    "spawn(node, ['--import', pathToFileURL(path.join(dir, 'p.mjs')).href]);",
    "const url = pathToFileURL(file).href; const preload = url; spawn(node, ['--loader', preload]);",
    "const preload = new URL('./p.mjs', import.meta.url).href; spawn(node, ['--import', preload]);",
    "spawn(node, ['--import', 'file:///D:/fake/p.mjs']);",
    "spawn(node, ['--import', 'node:fs']);",
    "spawn(node, ['--require', '@fake/register']);",
    "spawn(node, ['--loader', 'fake/register']);",
    "spawn(node, ['--import=' + pathToFileURL(file).href]);",
    'const env = { NODE_OPTIONS: `--import=${pathToFileURL(file).href}` };',
    'const env = { NODE_OPTIONS: `${options} --import ${JSON.stringify(pathToFileURL(file).href)}` };',
    '// spawn(node, ["--import", raw]);',
    'const pattern = /--import=raw/;',
  ]) {
    assert.deepEqual(unsafeNodeLoaderArguments(source), [], source);
  }
});
