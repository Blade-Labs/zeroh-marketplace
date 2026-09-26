#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// MessageDisplay: show real values on the user's screen. The stored message and
// what the model sees keep the tokens.
import { loadConfig } from '../lib/config.js';
import { saveQuietly, Vault } from '../lib/vault.js';
import { restore } from '../lib/secrets.js';
import { readStdinJson, emit, projectDir } from '../lib/hook-io.js';
import { containsToken, nameMentionedTokens } from '../lib/token-pattern.js';

const event = await readStdinJson();
const delta = event?.delta;
if (typeof delta !== 'string' || !containsToken(delta)) process.exit(0);
const root = projectDir(event);
try {
  await loadConfig({ cwd: root });
} catch {
  // An unreadable .zeroh.env leaves the process environment as it is.
}
if (process.env.ZEROH_DISPLAY_REAL_VALUES === '0') process.exit(0);

let restoredResult;
let vault;
try {
  vault = new Vault(root, { sessionId: event?.session_id });
  // A token the model plainly talks about is shown as ⟦token⟧, not restored.
  const named = nameMentionedTokens(delta);
  restoredResult = { ...restore(named.text, vault), changed: named.changed };
} catch {
  emit({
    hookSpecificOutput: {
      hookEventName: 'MessageDisplay',
      displayContent: delta,
    },
  });
  process.exit(0);
}
// Last-use bookkeeping never discards a restore that already worked.
saveQuietly(vault, 'ZeroH Disclosure (MessageDisplay)');
const { text, restored, changed } = restoredResult;
if (!restored.length && !changed) process.exit(0);
emit({
  hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: text },
});
