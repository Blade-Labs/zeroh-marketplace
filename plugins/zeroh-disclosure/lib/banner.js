// SPDX-License-Identifier: AGPL-3.0-only

// The session banner: the ZEROH art, version and tier, the protection status
// line and any warnings, in full, compact or off mode (ZEROH_BANNER).
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
const MODES = new Set(['full', 'compact', 'off']);
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

export function readBannerMode({
  env = process.env,
  home = zerohHome(env),
} = {}) {
  const environmentMode = String(env.ZEROH_BANNER || '').toLowerCase();
  if (MODES.has(environmentMode)) return environmentMode;
  try {
    const stored = JSON.parse(readFileSync(bannerFiles(home).config, 'utf8'));
    if (stored?.version === CONFIG_VERSION && MODES.has(stored.mode)) {
      return stored.mode;
    }
  } catch {
    // No setting, or an invalid setting, leaves the default behavior intact.
  }
  return 'banner';
}

export function writeBannerMode(
  mode,
  { env = process.env, home = zerohHome(env) } = {},
) {
  const normalized = String(mode || '').toLowerCase();
  if (!MODES.has(normalized)) {
    throw new Error('banner mode must be full, compact, or off');
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
//   no-login-item  the system refused the login item, so no settings entry
//   off         ZEROH_PROXY=off, or no proxy
//   turned-off  the user ran `proxy off` (it stays off until `proxy on`)
//   provider    Bedrock, Vertex or Foundry: traffic does not pass the proxy
//   down        the session's proxy does not answer
const MASKS_TYPING = new Set(['on', 'ready']);
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
  const side = [
    `ZeroH Disclosure ${version} · ${plan}`,
    '',
    paused
      ? '⚠ Paused: see the message below'
      : MASKS_TYPING.has(proxy)
        ? '✓ Protected: your secrets are masked'
        : '✓ Protected: files and output are masked',
    '',
    '/zeroh-disclosure:status for details',
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

// The full view (first run and /zeroh-disclosure:status, T-34): only what is
// protected right now and what needs attention, in plain words. Settings and
// paths live in the README; Claude answers the rest (skills/about).
const PROXY_WORDS = {
  on: 'Local proxy: running; this session goes through it.',
  ready:
    'Local proxy: ready; this session goes through it from your first prompt.',
  off: 'Local proxy: off.',
  'turned-off': 'Local proxy: off (you turned it off).',
  provider: 'Local proxy: not used with Bedrock, Vertex or Foundry.',
  overridden: 'Local proxy: not used; ANTHROPIC_BASE_URL is set elsewhere.',
  'no-login-item': "Local proxy: can't run on this system.",
  down: 'Local proxy: not running.',
};
export const ASK_LINE = "Ask Claude: 'what does ZeroH Disclosure protect?'";

function fullDetails({ proxy, paused, unmaskStatus, retention }) {
  const lines = [
    paused
      ? "Masking is paused: ZeroH can't open its vault (see below)."
      : MASKS_TYPING.has(proxy)
        ? 'Masks what you type, files Claude reads, command output and tool results.'
        : 'Masks files Claude reads, command output and tool results. A prompt with a secret is stopped, not sent.',
    'Images and scanned PDFs are not masked; they pass with a notice.',
  ];
  if (PROXY_WORDS[proxy]) lines.push(PROXY_WORDS[proxy]);
  if (unmaskStatus) lines.push(`Unmasked now: ${unmaskStatus}.`);
  if (retention) lines.push(retention);
  return lines.join('\n');
}

const CONTEXT_NOTE = {
  on: 'the proxy masks them',
  ready: 'the proxy masks them from your first prompt on',
};
const PROXY_LINE = {
  overridden:
    "⚠ ANTHROPIC_BASE_URL is set outside ZeroH's settings (your shell or another settings file), so what you type can't be masked; typed secrets are stopped instead",
  'no-login-item':
    "⚠ nothing on this system can keep ZeroH's local proxy running after a restart (no login item), so what you type can't be masked; typed secrets are stopped instead. Files and command output are still masked",
  off: '⚠ proxy off: typed secrets will be stopped, not masked',
  'turned-off':
    '⚠ proxy off (you turned it off): typed secrets are stopped, not masked. `/zeroh-disclosure:proxy on` turns it back on',
  provider:
    '⚠ Bedrock, Vertex or Foundry: the proxy is not used, so typed secrets will be stopped, not masked',
  down: "⚠ the local proxy isn't running: restart Claude Code; until then typed secrets are stopped, not sent",
};

// One coherent message per state: no warning when the proxy masks this
// session, one plain line otherwise.
export function warningLines({
  contextFindings = [],
  proxy = 'off',
  unmaskWarnings = [],
} = {}) {
  const lines = contextFindings.map(
    ({ displayPath, count }) =>
      `⚠ ${displayPath} has ${count} ${plural(count, 'secret')}: ${
        CONTEXT_NOTE[proxy] ?? 'they reach the model: the proxy is off'
      }`,
  );
  lines.push(...unmaskWarnings.map((warning) => `⚠ ${warning}`));
  if (PROXY_LINE[proxy]) lines.push(PROXY_LINE[proxy]);
  return lines;
}

export function buildBanner({
  mode = 'banner',
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
} = {}) {
  const effectiveMode = mode === 'banner' && firstRun ? 'full' : mode;
  const parts = [];
  if (effectiveMode === 'full' || effectiveMode === 'banner') {
    let text = `\n${artBlock({ version, plan, proxy, paused, colour })}`;
    if (effectiveMode === 'full') {
      text += `\n\n${fullDetails({ proxy, paused, unmaskStatus, retention })}`;
    }
    parts.push(text);
  } else if (effectiveMode === 'compact') {
    parts.push(
      paused
        ? `⚠ ZeroH Disclosure · ${plan} · paused: see the message below`
        : `🛡 ZeroH Disclosure · ${plan} · ${known.length} ${plural(known.length, 'secret')} protected · ${
            MASKS_TYPING.has(proxy) ? 'typing masked' : 'typing stopped'
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
