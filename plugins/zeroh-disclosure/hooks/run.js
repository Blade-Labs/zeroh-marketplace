#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Every ZeroH hook runs through this loader: `node run.js <hook>`. It reads
// the event and installs the fail-closed handlers before it loads the hook,
// so a hook that cannot even load (a syntax error, a missing or unreadable
// file, a module that throws while loading) still fails closed: the prompt is
// stopped, the tool call denied, the tool output withheld. The loader uses
// Node built-ins, ./fail-closed.js and lib/uninstall-marker.js only.
import { failClosedAnswer, HOOKS, oldNodeAnswer } from './fail-closed.js';

const name = process.argv[2];
if (!Object.hasOwn(HOOKS, name)) {
  process.stderr.write(`ZeroH Disclosure: unknown hook "${name}".\n`);
  process.exit(1);
}

// Node.js 20 or later (LP-B6): see oldNodeAnswer.
const oldNode = oldNodeAnswer(name, process.versions.node);
if (oldNode) {
  if (oldNode.stdout) process.stdout.write(oldNode.stdout);
  process.exit(0);
}

let raw = '';
if (!process.stdin.isTTY) {
  for await (const chunk of process.stdin) raw += chunk;
}
// After `uninstall` (T-38) a session still running does nothing more: no
// hook may set ZeroH up again (see lib/uninstall-marker.js).
let standDown = false;
try {
  const { hookStandsDown } = await import('../lib/uninstall-marker.js');
  let event = null;
  try {
    event = JSON.parse(raw);
  } catch {
    // A hook reports a malformed event itself.
  }
  standDown = hookStandsDown(name, event);
} catch {
  // The check itself failed: the hook runs, failing closed as always.
}
if (standDown) process.exit(0);

// The hook reads its event from here (lib/hook-io.js readStdinJson) and
// records here whether it answered or cleared the prompt.
const state = { emitted: false, cleared: false };
globalThis.zerohHook = { input: raw, state };

let failed = false;
function fail(error) {
  if (failed) return;
  failed = true;
  const answer = failClosedAnswer(name, raw, state, error);
  if (answer.stdout) process.stdout.write(answer.stdout);
  if (answer.stderr) process.stderr.write(answer.stderr);
  process.exit(answer.code);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

try {
  await import(`./${name}.js`);
} catch (error) {
  fail(error);
}
