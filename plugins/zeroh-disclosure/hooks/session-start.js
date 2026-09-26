#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// SessionStart: load configuration and known secrets, start or repair the
// local proxy, scan preloaded context and print the banner.
import path from 'node:path';
import { configWarning, loadConfig } from '../lib/config.js';
import {
  collectActiveTokens,
  loadSession,
  pruneCommitmentKeys,
} from '../lib/session.js';
import { Vault, vaultProblem, vaultRetention } from '../lib/vault.js';
import { loadKnownSecrets } from '../lib/secrets.js';
import { emit, projectDir, proxyState, readStdinJson } from '../lib/hook-io.js';
import { cleanupStaleRunFiles } from '../lib/late-bind.js';
import { ALLOW_FILE_NOTICE, readAllowRules } from '../lib/allow-rules.js';
import { scanSessionContext } from '../lib/context-scan.js';
import {
  checkSessionProxy,
  ensureDefaultProxy,
  repairDeadProxySetting,
} from '../lib/proxy-manager.js';
import {
  activeUnmaskStatus,
  colourAllowed,
  renderBanner,
  warningLines,
} from '../lib/banner.js';
import { registeredProjectRoots, registerProjectRoot } from '../lib/report.js';
import { pruneReceipts } from '../lib/receipt-retention.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const event = await readStdinJson();
try {
  cleanupStaleRunFiles();
} catch {
  // A file held open (Windows antivirus) is removed at the next start.
}
// One project root for sessions, vault and configuration (see projectDir).
const root = projectDir(event);
const cwd = root;
// Configuration first, so the proxy daemon and the hooks see the same
// settings (ZEROH_HOME comes only from the environment).
const config = await loadConfig({ cwd });
let proxyResult = null;
let proxyError = null;
let proxyRecovery = null;
try {
  // The daemon starts now; the first prompt puts this session behind it
  // (a settings write here would land before Claude Code watches the file).
  proxyResult = await ensureDefaultProxy({
    root,
    sessionId: event?.session_id,
    writeSettings: false,
  });
} catch (error) {
  proxyError = error;
  // Recover only this settings file: when it points at a ZeroH proxy that
  // does not answer, take the dead entry out so the next session reaches the
  // original upstream. A shared daemon other sessions use is never stopped.
  proxyRecovery = await repairDeadProxySetting().catch(() => null);
}
const source = event?.source || 'startup';
const sessionId = event?.session_id;

const session = await loadSession({ cwd, sessionId });
await registerProjectRoot({ cwd: root });
// Receipts past ZEROH_RECEIPT_RETENTION go, at most once a day (D-16); never
// this session's, never the vault. A failure never delays the session.
try {
  pruneReceipts({
    roots: await registeredProjectRoots(),
    currentSessionId: sessionId,
  });
} catch {
  // Tried again at the next start.
}
const allowRules = readAllowRules(root);
const known = loadKnownSecrets(root);
let vaultError = null;
try {
  const vault = new Vault(root, { sessionId });
  vault.refreshKnown(known);
  // SessionStart is where the user's configuration (environment plus
  // .zeroh.env) is known, so it stores the effective retention in the vault
  // for SessionEnd and the CLI. A resumed or compacted session keeps its
  // tokens; only a fresh start or /clear removes "session" leftovers.
  const freshStart = ['startup', 'clear'].includes(event?.source ?? 'startup');
  const retention = vaultRetention(process.env);
  vault.save({
    lifecycle: {
      event: 'start',
      fresh: freshStart,
      sessionId,
      retention,
    },
  });
  // Receipt commitment keys follow the vault's retention (LV-B4).
  const policy = vault.meta.retention || retention;
  pruneCommitmentKeys(root, {
    keep: sessionId,
    maxAgeMs: { '30d': 30 * DAY_MS, session: DAY_MS }[policy] ?? 7 * DAY_MS,
  });
} catch (error) {
  vaultError = error;
}
const isolatedContextHome = process.env.ZEROH_CREDENTIAL_HOME;
const contextFindings = scanSessionContext({
  cwd: root,
  known,
  ...(isolatedContextHome
    ? {
        home: isolatedContextHome,
        configDir: path.join(isolatedContextHome, '.claude'),
      }
    : {}),
});
let proxy = await proxyState({ sessionId });
// The first prompt can put this session behind the proxy only when the
// proxy is installed with its login item (see ensureDefaultProxy).
if (proxy === 'ready' && (proxyError || !proxyResult?.enabled)) {
  proxy = proxyResult && !proxyError ? 'no-login-item' : 'off';
}
// This session's base URL is fixed until Claude Code restarts: when it names
// a ZeroH proxy that is gone, try to bring it back now rather than at the
// first prompt.
let proxyGuard = null;
if (proxy === 'down') {
  proxyGuard = await checkSessionProxy({ sessionId, root }).catch(() => null);
  if (!proxyGuard?.block) proxy = await proxyState({ sessionId });
}
const proxyIsActive = proxy === 'on' || proxy === 'ready';
const unmask = await activeUnmaskStatus({ root, sessionId });
// One coherent message: the banner's third line and at most one line about
// the proxy (T-16). No URL or key is ever shown (T-17).
// A refused login item is told once, when it first happens, by the notice
// below (LP-B3); the banner then only says what is masked.
const warnings = warningLines({
  contextFindings,
  proxy: proxy === 'no-login-item' ? 'quiet' : proxy,
  unmaskWarnings: unmask.warnings,
});
if (proxyGuard?.report) {
  warnings.push(`  Details (stays on this machine): ${proxyGuard.report}`);
}
const vaultNotice = vaultError ? vaultNoticeText(vaultError) : null;
const banner = renderBanner({
  known,
  proxy,
  warnings,
  paused: Boolean(vaultError),
  // Claude Code renders colour in the SessionStart message only (T-28).
  colour: colourAllowed(),
});

const lines = [
  '🛡  ZeroH Disclosure is active. Secrets and personal data never reach you as real values.',
  '',
  'You see tokens such as [API_KEY-7a3f9e] in place of keys, passwords, emails and card',
  "numbers, in file contents, command output and the user's prompts. The same value always",
  'gets the same token.',
  '',
  'Work with the tokens as if they were the values:',
  '- Write them into commands, edits and tool calls exactly as shown. ZeroH puts the real',
  "  value back on the user's machine just before the command runs, and only for hosts that",
  '  secret is allowed to reach.',
  '- Prefer reading secrets from environment variables or files in code you write.',
  '- Never ask the user to paste or reveal a real value, and never try to reconstruct one.',
  '- If a real secret or personal value reached you unmasked, call report_missed_secret; ZeroH masks it from then on.',
  '- When the user asks you to report a value as missed, call report_missed_secret with it; that is their decision, as with unmask.',
  "- The user's screen shows real values in your answers; your transcript keeps the tokens.",
  '- The user sees plain [API_KEY-3f9a1c] as the real value. To name the token itself, write it as ⟦API_KEY-3f9a1c⟧:',
  '  say "⟦API_KEY-3f9a1c⟧ is a Stripe key", never "[API_KEY-3f9a1c] is a placeholder".',
  "- When the user asks you to unmask a kind of data, call request_unmask for it; they decide in Claude Code's dialog. Keys never unmask.",
  '- When the user asks to stop showing real values, call end_unmask (the kind, or all).',
  '',
  `Known secrets for this project: ${known.length} (from .env files and secret-named environment variables).`,
  `Typed prompts: ${proxyIsActive ? 'masked automatically by the ZeroH proxy' : 'a prompt containing a secret is stopped and the user resends a masked copy'}.`,
];

if (vaultError) {
  lines.push(
    '',
    '⚠ ZeroH Disclosure could not open its vault for this project. Tool output is withheld and tool calls are denied until the user runs `/zeroh-disclosure:doctor --fix`; tell the user if they ask why.',
  );
}

if (contextFindings.length) {
  lines.push('');
  for (const finding of contextFindings) {
    const protection = proxyIsActive
      ? 'the local proxy masks its text before it leaves this machine'
      : 'the local proxy is off, so remove the value before continuing';
    lines.push(
      `ZeroH Disclosure: ${finding.displayPath} contains ${finding.count} known or catalog secret(s); ${protection}.`,
    );
  }
}

lines.push('', `Receipt signing key: ${session.signingKey.keyId} (local).`);

const tokens = await collectActiveTokens(session.dir);
if (tokens.size > 0) {
  lines.push('', 'Active tokens carried in from prior turns:');
  for (const [token, type] of tokens) {
    lines.push(`  ${token} = ${type.toLowerCase()}`);
  }
}

if (source === 'compact') {
  lines.push(
    '',
    '(Context was just compacted. Tokens are durable; refer to them rather',
    'than the original values.)',
  );
}

const userNotices = banner ? [banner] : [];
// Said plainly to the user, once per session start (D-10, LV-B2).
if (vaultNotice) userNotices.push(vaultNotice);
if (session.ephemeral) {
  userNotices.push(
    "ZeroH Disclosure: ZeroH's own folder is read-only, so no receipts are kept in this session. Masking still works; a prompt holding a secret is stopped, not sent.",
  );
}
if (allowRules.ignored) userNotices.push(ALLOW_FILE_NOTICE);
const ignoredSettings = configWarning(config);
if (ignoredSettings) {
  userNotices.push(ignoredSettings);
  lines.push('', ignoredSettings);
}
if (proxyResult?.warning) {
  userNotices.push(`ZeroH Disclosure: ${proxyResult.warning}`);
}
if (proxyError) {
  const recovery = proxyRecovery?.repaired
    ? 'The dead local proxy setting was removed; other Claude Code settings were preserved.'
    : 'Claude Code settings were left unchanged.';
  userNotices.push(
    `ZeroH Disclosure: the local proxy could not start (${proxyError.message}). ${recovery} Typed secrets remain blocked.`,
  );
}

function vaultNoticeText(error) {
  const problem = vaultProblem(error);
  return `⚠ ZeroH Disclosure can't open its vault for this project: ${problem.reason}. Until that is fixed, tool output is withheld, tool calls are stopped and the proxy sends nothing. ${problem.fix}`;
}

emit({
  ...(userNotices.length ? { systemMessage: userNotices.join('\n') } : {}),
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: lines.join('\n'),
  },
});
process.exit(0);
