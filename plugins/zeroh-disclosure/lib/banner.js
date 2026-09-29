// SPDX-License-Identifier: AGPL-3.0-only

// The session banner: the ZEROH art, version and tier, the protection status
// line and any warnings. The first session after the install shows the full
// view (art, details, ask line); later sessions show the mode the user chose
// (/zeroh-disclosure:settings banner, ZEROH_BANNER): big (the art block),
// mini (one line, the default), compact (one line with counts) or off.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePrivateJson } from './private-fs.js';
import { plural } from './report-counts.js';
import { loginItemFix, loginItemReason } from './service-manager.js';
import { zerohHome } from './vault.js';

// ZEROH with the Blade triangle inside the O, as in the zeroh.io wordmark.
export const ART_LINES = Object.freeze([
  '███████ ███████ ██████   ██████  ██   ██',
  '   ███  ██      ██   ██ ██    ██ ██   ██',
  '  ███   █████   ██████  ██ ▗▖ ██ ███████',
  ' ███    ██      ██   ██ ██ ▟▙ ██ ██   ██',
  '███████ ███████ ██   ██  ██████  ██   ██',
]);

const GREEN = '\u001b[38;2;0;188;125m';
const RESET = '\u001b[0m';
// The modes a user can choose. `full` was the name of the every-session art
// view before 1.0.0: a saved or typed `full` keeps working as `big`.
export const BANNER_MODES = Object.freeze(['big', 'compact', 'mini', 'off']);
const MODE_ALIASES = Object.freeze({ full: 'big' });
const PRODUCT = 'ZeroH Disclosure';
const STATUS_COMMAND = '/zeroh-disclosure:status';
const DOCTOR_COMMAND = '/zeroh-disclosure:doctor';
const CONFIG_VERSION = 1;
const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function getPlan() {
  return 'Free';
}

export function getVersion() {
  try {
    return JSON.parse(
      readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'),
    ).version;
  } catch {
    return '1.0';
  }
}

export function bannerFiles(home = zerohHome()) {
  const resolved = path.resolve(home);
  return {
    config: path.join(resolved, 'banner.json'),
    shown: path.join(resolved, 'banner-shown'),
  };
}

// The one colour switch (T-24, T-28). Claude Code renders ANSI colour in the
// SessionStart systemMessage, so only that banner asks for colour; every
// command's `!` output and every other message shows escape codes raw and
// stays plain (buildBanner's default). NO_COLOR and TERM=dumb turn it off.
export function colourAllowed(env = process.env) {
  if (Object.hasOwn(env, 'NO_COLOR')) return false;
  if (String(env.TERM || '').toLowerCase() === 'dumb') return false;
  return Boolean(
    env.TERM || env.COLORTERM || env.TERM_PROGRAM || env.WT_SESSION,
  );
}

// A user-chosen mode (big, compact, mini, off, or the old `full`) in its
// current name, or null.
export function normalizeBannerMode(value) {
  const mode = String(value ?? '')
    .trim()
    .toLowerCase();
  if (BANNER_MODES.includes(mode)) return mode;
  return MODE_ALIASES[mode] ?? null;
}

// ZEROH_BANNER, else the saved mode, else 'default' (the full view on the
// first session, mini after it).
export function readBannerMode({
  env = process.env,
  home = zerohHome(env),
} = {}) {
  const environmentMode = normalizeBannerMode(env.ZEROH_BANNER);
  if (environmentMode) return environmentMode;
  try {
    const stored = JSON.parse(readFileSync(bannerFiles(home).config, 'utf8'));
    const storedMode =
      stored?.version === CONFIG_VERSION && normalizeBannerMode(stored.mode);
    if (storedMode) return storedMode;
  } catch {
    // No setting, or an invalid setting, leaves the default behavior intact.
  }
  return 'default';
}

export function writeBannerMode(
  mode,
  { env = process.env, home = zerohHome(env) } = {},
) {
  const normalized = normalizeBannerMode(mode);
  if (!normalized) {
    throw new Error('banner mode must be big, compact, mini, or off');
  }
  const file = bannerFiles(home).config;
  writePrivateJson(file, { version: CONFIG_VERSION, mode: normalized });
  return file;
}

// Best effort: a read-only ZeroH home shows the full view again next time.
function markBannerShown(home) {
  const file = bannerFiles(home).shown;
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    closeSync(openSync(file, 'wx', 0o600));
  } catch {
    // Already marked, or the home is read-only.
  }
}

export function secretSummary(known = []) {
  const count = known.length;
  const dotenv = known.filter(({ source }) => /^\.env(?:\.|$)/u.test(source));
  if (count > 0 && dotenv.length === count) {
    const sources = new Set(dotenv.map(({ source }) => source));
    const location = sources.size === 1 ? [...sources][0] : '.env files';
    return `${count} ${plural(count, 'secret')} from ${location} protected`;
  }
  return `${count} ${plural(count, 'secret')} protected`;
}

// What the banner says about typed text, from lib/hook-io.js proxyState:
//   on          this session's prompts go through the proxy and are masked
//   ready       the first prompt puts this session behind the proxy
//   overridden  the shell (or another settings file) sets ANTHROPIC_BASE_URL
//   off         ZEROH_PROXY=off, or no proxy
//   turned-off  the user ran `proxy off` (it stays off until `proxy on`)
//   provider    Bedrock, Vertex or Foundry: traffic does not pass the proxy
//   down        the session's proxy does not answer
const MASKS_TYPING = new Set(['on', 'ready']);

// The one protection state both the art block and the mini line show: a
// mark, the words, and the command that helps (the fix when something needs
// attention, the status command when nothing does).
export function protectionState({ proxy = 'off', paused = false } = {}) {
  if (paused) {
    return {
      mark: '⚠',
      words: 'Paused: see the message below',
      command: DOCTOR_COMMAND,
    };
  }
  if (MASKS_TYPING.has(proxy)) {
    return {
      mark: '✓',
      words: 'Protected: your secrets are masked',
      command: STATUS_COMMAND,
    };
  }
  return {
    mark: '✓',
    words: 'Protected: files and output are masked',
    // Typing isn't masked: turn the proxy back on, or let doctor say why.
    // Bedrock, Vertex and Foundry never pass the proxy, so there is
    // nothing to fix there.
    command:
      proxy === 'turned-off'
        ? '/zeroh-disclosure:proxy on'
        : proxy === 'provider'
          ? STATUS_COMMAND
          : DOCTOR_COMMAND,
  };
}
// Plain unless the caller asks for colour (see colourAllowed): a command's
// `!` output shows ANSI codes raw (T-24).
function artBlock({ version, plan, proxy, paused, colour }) {
  // Name, a plain promise and where to look: the art is 40 columns, so each
  // line stays short enough not to wrap in an 80-column terminal. Counts,
  // proxy state and active unmasks live in /zeroh-disclosure:status, and
  // anything that needs attention is printed as a warning line below.
  // Line 1 names the product in full ("ZeroH Disclosure 1.0.0 · Free"):
  // 40 art columns + 3 spaces + at most 37 characters of text. Lines 1, 3
  // and 5 align with the top, middle and bottom of the art.
  const state = protectionState({ proxy, paused });
  const side = [
    `${PRODUCT} ${version} · ${plan}`,
    '',
    `${state.mark} ${state.words}`,
    '',
    `${STATUS_COMMAND} for details`,
  ];
  return ART_LINES.map((line, index) => {
    // In colour, the Blade triangle keeps the terminal's own text colour so
    // it reads as a mark inside the green O, as on zeroh.io.
    const art = colour
      ? `${GREEN}${line.replace(/[▗▖▟▙]+/u, (mark) => `${RESET}${mark}${GREEN}`)}${RESET}`
      : line;
    return side[index] ? `${art}   ${side[index]}` : art;
  }).join('\n');
}

// The mini line: the art block's name, state and plan in one line, ending
// with the command that helps in this state. In colour the product name is
// the art's green.
function miniLine({ plan, proxy, paused, colour }) {
  const state = protectionState({ proxy, paused });
  const name = colour ? `${GREEN}${PRODUCT}${RESET}` : PRODUCT;
  return `${name} ${state.mark} ${state.words} · ${plan} · ${state.command}`;
}

// The full view (first run and /zeroh-disclosure:status, T-34): three lines
// under the art (owner, 2026-09-28): where it runs and what it masks, what
// passes, and the question to ask Claude. The proxy's own state is not
// repeated here: a proxy that doesn't mask typing is already said by the
// first line and by its warning line below, and the status line shows it.
export const ASK_LINE = "Ask Claude: 'what does ZeroH Disclosure protect?'";

// What happens to a secret the user types when the proxy can't mask it, by
// the `uncertain` setting (lib/config.js): sent with a "not protected" line
// by default, stopped with `uncertain block`.
function typedSecretWords(uncertain) {
  return uncertain === 'block'
    ? 'typed secrets are stopped, not sent'
    : 'a typed secret is sent with a "not protected" line';
}

function fullDetails({ proxy, paused, unmaskStatus, retention, uncertain }) {
  const lines = [
    paused
      ? "Masking is paused: ZeroH can't open its vault (see below)."
      : MASKS_TYPING.has(proxy)
        ? 'Runs on your machine: masks what you type, files Claude reads, command output and tool results.'
        : // A session whose proxy is gone can't send at all (D-10).
          proxy === 'down'
          ? "Runs on your machine: masks files Claude reads, command output and tool results. The local proxy isn't running, so no prompt is sent until it is back."
          : uncertain === 'block'
            ? 'Runs on your machine: masks files Claude reads, command output and tool results. A prompt with a secret is stopped, not sent.'
            : 'Runs on your machine: masks files Claude reads, command output and tool results. What you type is not masked: a prompt with a secret is sent, with a notice.',
    'Images and scanned PDFs are not masked; they pass with a notice.',
  ];
  if (unmaskStatus) lines.push(`Unmasked now: ${unmaskStatus}.`);
  if (retention) lines.push(retention);
  return lines.join('\n');
}

const CONTEXT_NOTE = {
  on: 'the proxy masks them',
  ready: 'the proxy masks them from your first prompt on',
  down: 'nothing is sent until the local proxy is back',
};
function proxyLine(proxy, uncertain) {
  const typed = typedSecretWords(uncertain);
  return {
    overridden: `⚠ ANTHROPIC_BASE_URL is set outside ZeroH's settings (your shell or another settings file), so what you type can't be masked; ${typed}`,
    off: `⚠ proxy off: what you type isn't masked; ${typed}`,
    'turned-off': `⚠ proxy off (you turned it off): what you type isn't masked; ${typed}. \`/zeroh-disclosure:proxy on\` turns it back on`,
    provider: `⚠ Bedrock, Vertex or Foundry: the proxy is not used, so what you type isn't masked; ${typed}`,
    // A session pointing at a proxy that is gone can't send at all (D-10).
    down: "⚠ the local proxy isn't running: restart Claude Code; until then typed secrets are stopped, not sent",
  }[proxy];
}

// One coherent message per state: no warning when the proxy masks this
// session, one plain line otherwise.
export function warningLines({
  contextFindings = [],
  proxy = 'off',
  unmaskWarnings = [],
  uncertain = 'pass',
  // proxy.json's record of a refused login item, or null.
  loginItemRefused = null,
} = {}) {
  const lines = contextFindings.map(
    ({ displayPath, count }) =>
      `⚠ ${displayPath} has ${count} ${plural(count, 'secret')}: ${
        CONTEXT_NOTE[proxy] ?? 'they reach the model: the proxy is off'
      }`,
  );
  lines.push(...unmaskWarnings.map((warning) => `⚠ ${warning}`));
  const line = proxyLine(proxy, uncertain);
  if (line) lines.push(line);
  if (loginItemRefused && MASKS_TYPING.has(proxy)) {
    lines.push(loginItemLine(loginItemRefused));
  }
  return lines;
}

// /zeroh-disclosure:status's lines about the proxy itself, as it is now,
// never as it is meant to be: whether it answers, whether this session goes
// through it, and whether a login item starts it after a restart (and why
// not, with the fix). `runtime` is proxy-manager's proxyRuntimeStatus. What
// happens to a secret in the prompt that puts the session behind the proxy
// follows the `uncertain` setting: sent with a "not protected" line by
// default, stopped with `uncertain block` (hooks/user-prompt-submit.js).
export function proxyStatusLines({
  proxy = 'off',
  runtime = null,
  uncertain = 'pass',
} = {}) {
  if (
    !runtime ||
    ['off', 'turned-off', 'provider', 'overridden'].includes(proxy)
  ) {
    return [];
  }
  const firstPrompt =
    uncertain === 'block'
      ? 'a secret in that prompt is stopped, not sent'
      : 'a secret in that prompt is sent, with a "not protected" line';
  const lines = [];
  if (proxy === 'on') {
    lines.push('Local proxy: running; this session goes through it.');
  } else if (proxy === 'down') {
    lines.push(
      "Local proxy: not answering; this session's model requests can't be sent until it is back. Restart Claude Code, or run /zeroh-disclosure:doctor.",
    );
  } else if (runtime.running) {
    lines.push(
      `Local proxy: running; this session is not behind it yet. Your next prompt puts it there (${firstPrompt}).`,
    );
  } else {
    lines.push(
      `Local proxy: not running. Your next prompt starts it and puts this session behind it (${firstPrompt}).`,
    );
  }
  if (runtime.loginItem) {
    lines.push('Login item: registered; it starts the proxy after a restart.');
  } else if (runtime.loginItemRefused) {
    lines.push(
      `Login item: not registered: ${loginItemReason(runtime.loginItemRefused)}. The proxy runs only while Claude Code does. To fix: ${loginItemFix(runtime.loginItemRefused)}.`,
    );
  } else if (runtime.installed) {
    lines.push(
      'Login item: not registered yet; the next Claude Code session registers it.',
    );
  }
  return lines;
}

// The system refused the login item (lib/service-manager.js): the proxy runs
// while Claude Code does, so typing is masked, but nothing starts it after a
// restart. Said every session, with why and the fix, until it registers.
export function loginItemLine(record) {
  return `⚠ no login item: ${loginItemReason(record)}. The local proxy runs while Claude Code does and each new session starts it again, but not by itself after a restart. To fix: ${loginItemFix(record)}`;
}

// mode: a user mode (big, compact, mini, off), 'full' (the art with details,
// for the first run and /zeroh-disclosure:status) or 'default' (full on the
// first run, mini after it).
export function buildBanner({
  mode = 'default',
  firstRun = false,
  version = getVersion(),
  plan = getPlan(),
  known = [],
  proxy = 'off',
  warnings = [],
  // The vault cannot be opened: nothing is protected as promised until the
  // user runs doctor --fix, so the banner must not say "Protected".
  paused = false,
  // Only the SessionStart banner passes colourAllowed() here.
  colour = false,
  // Active unmask grants in one line (activeUnmaskStatus().status).
  unmaskStatus = '',
  // The receipt retention policy in one line (lib/receipt-retention.js).
  retention = '',
  // The `uncertain` setting: what happens to a typed secret without the proxy.
  uncertain = 'pass',
} = {}) {
  const effectiveMode =
    mode === 'default'
      ? firstRun
        ? 'full'
        : 'mini'
      : mode === 'full'
        ? 'full'
        : (normalizeBannerMode(mode) ?? 'mini');
  const parts = [];
  if (effectiveMode === 'full' || effectiveMode === 'big') {
    let text = `\n${artBlock({ version, plan, proxy, paused, colour })}`;
    if (effectiveMode === 'full') {
      text += `\n\n${fullDetails({ proxy, paused, unmaskStatus, retention, uncertain })}`;
    }
    parts.push(text);
  } else if (effectiveMode === 'mini') {
    parts.push(miniLine({ plan, proxy, paused, colour }));
  } else if (effectiveMode === 'compact') {
    parts.push(
      paused
        ? `⚠ ZeroH Disclosure · ${plan} · paused: see the message below`
        : `🛡 ZeroH Disclosure · ${plan} · ${known.length} ${plural(known.length, 'secret')} protected · ${
            MASKS_TYPING.has(proxy)
              ? 'typing masked'
              : uncertain === 'block'
                ? 'typing stopped'
                : 'typing not masked'
          }`,
    );
  }
  if (warnings.length) parts.push(warnings.join('\n'));
  if (effectiveMode === 'full') parts.push(ASK_LINE);
  return { text: parts.join('\n'), effectiveMode };
}

export function renderBanner({
  env = process.env,
  home = zerohHome(env),
  mode = readBannerMode({ env, home }),
  markShown = true,
  ...status
} = {}) {
  const firstRun = !existsSync(bannerFiles(home).shown);
  const rendered = buildBanner({ mode, firstRun, ...status });
  if (markShown && rendered.effectiveMode === 'full') markBannerShown(home);
  return rendered.text;
}

export async function activeUnmaskStatus({
  root,
  home = zerohHome(),
  sessionId = null,
  now = Date.now(),
} = {}) {
  if (!existsSync(new URL('./unmask.js', import.meta.url))) {
    return { status: '', warnings: [] };
  }
  try {
    const { activeGrants, formatStatusline } = await import('./unmask.js');
    const grants = activeGrants(root, { home, sessionId, now });
    return {
      status: formatStatusline(grants, now),
      warnings: grants.map((grant) => {
        if (grant.expires_at == null) {
          return `${grant.kind} unmasked until this session ends`;
        }
        const minutes = Math.max(
          0,
          Math.ceil((Date.parse(grant.expires_at) - now) / 60_000),
        );
        return `${grant.kind} unmasked for ${minutes} more minutes`;
      }),
    };
  } catch {
    return { status: '', warnings: [] };
  }
}
