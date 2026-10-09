// SPDX-License-Identifier: AGPL-3.0-only

// SPDX-License-Identifier: MIT
// Test-only CST adapter: never an alternate destination policy.
import v8 from 'node:v8';
import { fileURLToPath } from 'node:url';
import { Parser, Language } from './vendor/runtime/web-tree-sitter.js';

export async function createBashParser({ liftoff = true } = {}) {
  // Node waits for background TurboFan wasm tier-up at exit; the owner accepted
  // Liftoff on 2026-10-05. An unsupported flag leaves parsing functional.
  if (liftoff) {
    try {
      v8.setFlagsFromString('--liftoff-only');
    } catch {
      /* timing gate catches fallback cost */
    }
  }
  await Parser.init({
    locateFile: () =>
      fileURLToPath(
        new URL('./vendor/runtime/web-tree-sitter.wasm', import.meta.url),
      ),
  });
  const language = await Language.load(
    fileURLToPath(
      new URL('./vendor/bash/tree-sitter-bash.wasm', import.meta.url),
    ),
  );
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

function snapshot(node) {
  return {
    type: node.type,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    text: node.text,
    children: node.namedChildren.map(snapshot),
  };
}

export function parseWithBashParser(parser, command) {
  const tree = parser.parse(command);
  try {
    return { hasError: tree.rootNode.hasError, root: snapshot(tree.rootNode) };
  } finally {
    tree.delete();
  }
}

export async function parseBash(command) {
  const parser = await createBashParser();
  try {
    return parseWithBashParser(parser, command);
  } finally {
    parser.delete();
  }
}

export function nodesOfType(root, type) {
  const matches = root.type === type ? [root] : [];
  for (const child of root.children) matches.push(...nodesOfType(child, type));
  return matches;
}
