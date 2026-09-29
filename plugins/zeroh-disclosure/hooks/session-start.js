#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// SessionStart: load configuration and known secrets, start or repair the
// local proxy, scan preloaded context and print the banner.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configWarning, loadConfig, uncertainMode } from '../lib/config.js';
import {
  collectActiveTokens,
  loadSession,
  pruneCommitmentKeys,
} from '../lib/session.js';
import { Vault, vaultProblem, vaultRetention } from '../lib/vault.js';
import { loadKnownSecrets, usersKnownSecrets } from '../lib/secrets.js';
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
import { updateSessionStatus } from '../lib/session-status.js';
import { recordPluginRoot } from '../lib/statusline-settings.js';
import {
  checkPluginIntegrity,
  integrityLines,
} from '../lib/plugin-integrity.js';
import { shadowedStatusline } from '../lib/first-run.js';
import { managedSettingsPath } from '../lib/statusline.js';
import { zerohHome } from '../lib/private-fs.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const event = await readStdinJson();
// The status line shows "starting" until this hook has finished.
updateSessionStatus(
  { cwd: projectDir(event), sessionId: event?.session_id },
  (status) => {
    status.phase = 'starting';
    return status;
  },
);
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
// proxy is set up (see ensureDefaultProxy; without a login item it runs for
// the session all the same).
if (proxy === 'ready' && (proxyError || !proxyResult?.enabled)) {
  proxy = 'off';
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
  proxy,
  unmaskWarnings: unmask.warnings,
  uncertain: uncertainMode(),
  // The first time, the notice above already says it.
  loginItemRefused: proxyResult?.warning
    ? null
    : (proxyResult?.loginItemRefused ?? null),
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
  uncertain: uncertainMode(),
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
  "  value back on the user's machine just before the command runs. For a host ZeroH can read",
  '  that the value may not reach, ZeroH stops the command before anything is sent and tells the',
  "  user how to allow it, so you don't need to ask first for that reason.",
  "  Where ZeroH can't tell where a command sends the value (a script, a variable host, git push),",
  '  the real value is put back and the command runs with a notice: before sending a secret',
  "  somewhere the user didn't ask for, ask the user.",
  '- In commands you run, write the token; ZeroH puts the value back and checks the host.',
  '  Only code you save to files should read secrets from environment variables.',
  '- Never ask the user to paste or reveal a real value, and never try to reconstruct one.',
  '- If a real secret or personal value reached you unmasked, call report_missed_secret; ZeroH masks it from then on.',
  '- When the user asks you to report a value as missed, call report_missed_secret with it; that is their decision, as with unmask.',
  "- The user's screen shows real values in your answers. Tool output and file reads are stored with tokens,",
  "  but Claude Code's own session file (~/.claude/projects/…/*.jsonl) keeps what the user typed as typed,",
  '  values shown under an unmask and the real values ZeroH puts back into Edit, Write and MCP inputs:',
  "  don't copy, upload or share it without telling the user it may hold their real values.",
  '- The user sees plain [API_KEY-3f9a1c] as the real value. To name the token itself, write it as ⟦API_KEY-3f9a1c⟧:',
  '  say "⟦API_KEY-3f9a1c⟧ is a Stripe key", never "[API_KEY-3f9a1c] is a placeholder".',
  "- When the user asks you to unmask a kind of data, call request_unmask for it; they decide in Claude Code's dialog. Keys never unmask.",
  '- When the user asks to stop showing real values, call end_unmask (the kind, or all).',
  "- To change how ZeroH's status line looks, when the user asks, edit this with Write or Edit:",
  `  ${path.join(zerohHome(), 'statusline-style.json')}`,
  '  {"version": 1} plus any of: fields (order of shield, name, state, fix, masked, sent,',
  '  notProtected, unmask, receipt), separator, labels, emoji (true/false), wording',
  '  ("long"/"compact"), colour (true/false), onlyWhenNotProtected, position ("line": its own',
  '  line under the user\'s status line, or "end": after it). Never change statusLine.',
  "- If the user says ZeroH isn't working, or ZeroH shows 🟡 or 🔴, suggest /zeroh-disclosure:doctor (then --fix); never run it yourself.",
  '',
  `Known secrets for this project: ${usersKnownSecrets(known).length} (from .env files and secret-named environment variables).`,
  `Typed prompts: ${
    proxyIsActive
      ? 'masked automatically by the ZeroH proxy'
      : uncertainMode() === 'block'
        ? 'a prompt containing a secret is stopped and the user resends a masked copy'
        : 'not masked; a prompt containing a secret is sent as typed, and the user is told'
  }.`,
];

if (vaultError) {
  lines.push(
    '',
    uncertainMode() === 'block'
      ? '⚠ ZeroH Disclosure could not open its vault for this project. Tool output is withheld and tool calls are denied until the user runs `/zeroh-disclosure:doctor --fix`; tell the user if they ask why.'
      : '⚠ ZeroH Disclosure could not open its vault for this project. Until the user runs `/zeroh-disclosure:doctor --fix`, tool output reaches you unmasked and tokens cannot be put back into commands; tell the user if they ask why.',
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
    "ZeroH Disclosure: ZeroH's own folder is read-only, so no receipts are kept in this session. Masking still works.",
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
    `ZeroH Disclosure: the local proxy could not start (${proxyError.message}). ${recovery} ${
      uncertainMode() === 'block'
        ? 'Typed secrets remain blocked.'
        : 'Until it runs, what you type is not masked: a typed secret is sent with a "not protected" line.'
    }`,
  );
}

// What the status line shows for this session (lib/statusline.js).
updateSessionStatus({ cwd: root, sessionId }, (status) => {
  status.proxy = proxy;
  status.paused = Boolean(vaultError);
  status.phase = 'ready';
  return status;
});
// Where the status line command finds this plugin version, and, for the
// first prompt, which marketplace it came from (lib/first-run.js).
const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
recordPluginRoot(zerohHome(), pluginRoot);
// A folder an earlier build left for this version, which `claude plugin
// update` keeps as it is (lib/plugin-integrity.js): said at every session
// start until the user replaces it. About 35 ms (one git ls-tree). It can
// only speak when that folder's code already has this check.
{
  const [found, fix] = integrityLines(checkPluginIntegrity({ pluginRoot }));
  if (found) userNotices.push(`⚠ ${found} ${fix}`);
}
// A project or managed settings file that sets its own status line over
// ZeroH's: said once per session start.
{
  const shadowed = shadowedStatusline({
    root,
    managedPath: managedSettingsPath(),
  });
  if (shadowed) userNotices.push(shadowed);
}

function vaultNoticeText(error) {
  const problem = vaultProblem(error);
  const until =
    uncertainMode() === 'block'
      ? 'tool output is withheld, tool calls are stopped and the proxy sends nothing'
      : 'nothing can be masked: prompts, tool calls and tool output go through as they are, each with a "not protected" line, and tokens stay tokens';
  return `⚠ ZeroH Disclosure can't open its vault for this project: ${problem.reason}. Until that is fixed, ${until}. ${problem.fix}`;
}

emit({
  ...(userNotices.length ? { systemMessage: userNotices.join('\n') } : {}),
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: lines.join('\n'),
  },
});
process.exit(0);
