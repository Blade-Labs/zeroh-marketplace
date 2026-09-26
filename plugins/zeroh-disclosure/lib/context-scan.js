// SPDX-License-Identifier: AGPL-3.0-only

// Session-start scan of what Claude Code preloads (CLAUDE.md files, their
// @imports and auto-memory): reports file names and counts, never values.
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectSensitiveData } from './detector.js';

const MAX_CONTEXT_FILE = 512 * 1024;

function readRegularFile(file) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_CONTEXT_FILE) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function importsIn(text, file, home) {
  const imports = [];
  for (const match of text.matchAll(/(?:^|\s)@((?:[^\s]|\\ )+)/gmu)) {
    let name = match[1].replace(/\\ /gu, ' ');
    if (name.startsWith('~/')) name = path.join(home, name.slice(2));
    const resolved = path.resolve(path.dirname(file), name);
    if (readRegularFile(resolved) !== null) imports.push(resolved);
  }
  return imports;
}

function memoryFiles(directory) {
  const files = [];
  const visit = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && readRegularFile(target) !== null)
        files.push(target);
    }
  };
  visit(directory);
  return files;
}

function encodedProjectDirectory(cwd) {
  return path.resolve(cwd).replace(/[^A-Za-z0-9]/gu, '-');
}

function countKnown(text, known) {
  const spans = [];
  for (const secret of known) {
    let offset = text.indexOf(secret.value);
    while (offset !== -1) {
      spans.push([offset, offset + secret.value.length]);
      offset = text.indexOf(secret.value, offset + secret.value.length);
    }
  }
  return spans;
}

export function scanSessionContext({
  cwd = process.cwd(),
  known = [],
  home = process.env.ZEROH_CREDENTIAL_HOME || os.homedir(),
  configDir = process.env.ZEROH_CLAUDE_SETTINGS
    ? path.dirname(process.env.ZEROH_CLAUDE_SETTINGS)
    : process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'),
} = {}) {
  const roots = [
    path.join(cwd, 'CLAUDE.md'),
    path.join(cwd, 'CLAUDE.local.md'),
    path.join(cwd, '.claude', 'CLAUDE.md'),
    path.join(home, '.claude', 'CLAUDE.md'),
  ];
  roots.push(
    ...memoryFiles(
      path.join(configDir, 'projects', encodedProjectDirectory(cwd), 'memory'),
    ),
  );

  const queue = [...roots];
  const seen = new Set();
  const findings = [];
  while (queue.length) {
    const file = path.resolve(queue.shift());
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readRegularFile(file);
    if (text === null) continue;
    queue.push(...importsIn(text, file, home));
    const spans = countKnown(text, known);
    const detected = detectSensitiveData(text, { profile: 'secrets' });
    for (const finding of detected) {
      if (
        !spans.some(
          ([start, end]) => finding.start < end && start < finding.end,
        )
      ) {
        spans.push([finding.start, finding.end]);
      }
    }
    const count = spans.length;
    if (count > 0) {
      findings.push({
        file,
        displayPath: path.relative(cwd, file) || path.basename(file),
        count,
      });
    }
  }
  return findings;
}
