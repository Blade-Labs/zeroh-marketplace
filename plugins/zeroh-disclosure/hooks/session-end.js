#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { removeSessionCache } from '../lib/statusline-cache.js';
// SessionEnd: apply the vault's retention policy. With "session" retention,
// detected values last used by the ending session are removed; with 7d/30d,
// values past the window are. The policy is the one SessionStart stored in
// the vault; this process's configuration is only the fallback. Known values
// (.env, credential files) always stay.
import { loadConfig } from '../packages/zeroh-disclosure-core/config.js';
import {
  Vault,
  vaultRetention,
} from '../packages/zeroh-disclosure-core/vault.js';
import { removeCommitmentKey } from '../packages/zeroh-disclosure-core/session.js';
import { endSessionRoute } from '../packages/local-proxy/proxy-state.js';
import { projectDir, readStdinJson } from '../lib/hook-io.js';

const event = await readStdinJson();
const root = projectDir(event);
try {
  await loadConfig({ cwd: root });
} catch {
  // Fall back to the process environment.
}
const sessionId = event?.session_id;
removeSessionCache(sessionId);
try {
  const vault = new Vault(root, { sessionId });
  vault.save({ lifecycle: { event: 'end', sessionId } });
  // With "session" retention the receipts' commitment key goes with the
  // session's values (LV-B4); other policies prune at SessionStart.
  if ((vault.meta.retention || vaultRetention(process.env)) === 'session') {
    removeCommitmentKey(root, sessionId);
  }
} catch {
  // The next SessionStart prunes again if the vault cannot be opened now.
}
// The session is over: its route no longer counts as a live plugin session
// (the daemon's lifecycle, and which settings entries it keeps); a resumed
// session registers it again.
try {
  endSessionRoute({ sessionId });
} catch {
  // Pruned with the other routes after the route window.
}
