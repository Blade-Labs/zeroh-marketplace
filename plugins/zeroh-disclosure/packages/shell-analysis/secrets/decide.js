// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TOP_LEVEL_DOMAINS } from '../../zeroh-disclosure-core/detector.js';
import { isLoopbackHost } from '../../local-proxy/loopback.js';
import { shellDestinations } from '../shell-destinations.js';
import {
  containsToken,
  TOKEN_PATTERN,
  TOKEN_RE,
} from '../../zeroh-disclosure-core/token-pattern.js';

const TOKEN_SPLIT_RE = new RegExp(`(${TOKEN_PATTERN})`, 'u');

const PROVIDER_HOSTS = [
  [
    /^(?:sk|rk)_(?:live|test)_|^whsec_/,
    ['api.stripe.com', 'files.stripe.com', 'connect.stripe.com'],
    'Stripe',
  ],
  [/^sk-ant-/, ['api.anthropic.com'], 'Anthropic'],
  [/^sk-(?:proj|svcacct|admin)-/, ['api.openai.com'], 'OpenAI'],
  [/^sk-or-v1-/, ['openrouter.ai'], 'OpenRouter'],
  [
    /^gh[pousr]_|^github_pat_/,
    [
      'api.github.com',
      'github.com',
      'uploads.github.com',
      '*.githubusercontent.com',
    ],
    'GitHub',
  ],
  [/^glpat-/, ['gitlab.com'], 'GitLab'],
  [/^(?:AKIA|ASIA)/, ['*.amazonaws.com'], 'AWS'],
  [/^AIza/, ['*.googleapis.com'], 'Google'],
  [/^xox[abposr]-|^xapp-/, ['slack.com', '*.slack.com'], 'Slack'],
  [/^hf_/, ['huggingface.co', '*.huggingface.co'], 'Hugging Face'],
  [/^npm_/, ['registry.npmjs.org'], 'npm'],
  [/^zhk_/, ['*.zeroh.io'], 'ZeroH'],
];

// The built-in destinations of a value, by its provider prefix: the provider's
// name and hosts, or null when no provider is recognised.
export function builtInDestinations(value) {
  for (const [re, hosts, provider] of PROVIDER_HOSTS) {
    if (re.test(String(value ?? ''))) return { provider, hosts: [...hosts] };
  }
  return null;
}
const ROOT_ZONE_TLDS = new Set(TOP_LEVEL_DOMAINS);

function addHost(hosts, candidate) {
  // A name with a token in it (`[API_KEY-3f9a1c].evil.example`, read from
  // the command the model wrote) keeps the token as written.
  const host = containsToken(candidate)
    ? String(candidate)
        .split(TOKEN_SPLIT_RE)
        .map((piece, i) => (i % 2 ? piece : piece.toLowerCase()))
        .join('')
        .replace(/\.$/, '')
    : String(candidate)
        .toLowerCase()
        .replace(/^\[|\]$/g, '')
        .replace(/\.$/, '');
  // This machine is never a destination (the one loopback rule).
  if (!host || isLoopbackHost(host)) return;
  hosts.add(host);
}

function validIpv4(value) {
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255,
    )
  );
}

function validIpv6(value) {
  if (!value.includes(':')) return false;
  try {
    return new URL(`http://[${value}]`).hostname.length > 0;
  } catch {
    return false;
  }
}

function hasRootZoneTld(host) {
  return ROOT_ZONE_TLDS.has(host.slice(host.lastIndexOf('.') + 1));
}

// Source, script and data file extensions that are also delegated TLDs:
// `app.py:12`, `main.tf:3` is a file and a line, not a host and a port.
const FILE_EXTENSION_TLDS = new Set([
  'ac', // configure.ac
  'am', // Makefile.am
  'as', // ActionScript
  'bz',
  'cc', // C++
  'cr', // Crystal
  'gs', // Apps Script
  'in', // Makefile.in, requirements.in
  'mk', // make
  'ml', // OCaml
  'md', // Markdown
  'mo', // gettext
  'mov',
  'nu', // Nushell
  'pl', // Perl
  'pm', // Perl module
  'ps', // PostScript
  'pub', // id_ed25519.pub
  'py', // Python
  're', // ReasonML
  'rs', // Rust
  'sc', // Scala script
  'sh', // shell
  'so', // shared object
  'st',
  'sv', // SystemVerilog
  'tf', // Terraform
  'work', // go.work
  'zip',
]);

// True when `name.ext:N` is a file and a line (`grep -n x app.py:12`,
// `src/main.rs:40`), not a host and a port.
function fileAndLine(text, start, host) {
  const prev = text[start - 1];
  if ((prev === '/' && text[start - 2] !== '/') || prev === '\\') return true;
  return FILE_EXTENSION_TLDS.has(host.slice(host.lastIndexOf('.') + 1));
}

// The commands inside `text`: the `command` fields of a tool input in JSON,
// or the text itself.
function commandsIn(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const input = JSON.parse(trimmed);
      return typeof input?.command === 'string' ? [input.command] : [];
    } catch {
      // Not JSON: read it as a command.
    }
  }
  return [text];
}

// The destination operands of the network commands in `command` (Bash, or
// PowerShell when Bash cannot read it), loopback excluded.
export function networkHostsIn(command, { shell = null } = {}) {
  const hosts = new Set();
  let found = shellDestinations(command, { shell: shell || 'bash' });
  if (!found.ok && !shell) {
    const powershell = shellDestinations(command, { shell: 'powershell' });
    if (powershell.ok) found = powershell;
  }
  for (const host of found.destinations) addHost(hosts, host);
  return [...hosts];
}

// Where a text names a destination host. Outside a network command's
// operands (read by networkHostsIn with the shared tokenizer), a host counts
// only where its spelling makes it one: a URL (`https://host/…`,
// `//host/…`), `user@host`, `host:port`, `[v6]:port`. A bare dotted word
// anywhere else (`--query sku.name`, `--set image.tag=…`, `gcloud config set
// compute.zone …`, `app.kubernetes.io/name`, a JSON key, code) is a field,
// a setting, a file or a name, not a destination, even when its last label
// is a real TLD (`.name`, `.zone`, `.io`). A bare address (`--source-
// address-prefixes 198.51.100.0/24`) is data the same way. The program that
// reads such a word is either one ZeroH knows (its operands are read) or an
// uncertain destination the caller reports (product principle 5).
//
// `values`: email addresses ZeroH put back into `text`. An address passed as
// data (`git -c user.email=…`, a form field) names no destination; its
// domain counts only as the operand of a network command (`ssh user@host`),
// which networkHostsIn reads.
export function hostsIn(text, { values = [] } = {}) {
  text = String(text);
  const restoredAddresses = new Set(
    [...values].map((value) => String(value).toLowerCase()),
  );
  const hosts = new Set();
  for (const command of commandsIn(text))
    for (const host of networkHostsIn(command)) hosts.add(host);
  for (const m of text.matchAll(
    /\b(?:https?|wss?|ftp):\/\/(?:[^\s@/'"]*@)?([A-Za-z0-9.-]+|\[[0-9a-f:.]+\])/gi,
  )) {
    addHost(hosts, m[1]);
  }
  const domain =
    /(?<![A-Za-z0-9._%+-])(?:[A-Za-z0-9._%+-]+@)?((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[Xx][Nn]--[A-Za-z0-9](?:[A-Za-z0-9-]{0,57}[A-Za-z0-9])?|[A-Za-z]{2,63}))(?::\d{1,5})?(?![A-Za-z0-9-])/g;
  for (const match of text.matchAll(domain)) {
    const host = match[1].toLowerCase();
    const offset = match[0].lastIndexOf(match[1]);
    const start = match.index + offset;
    const userAt = match[0].includes('@');
    const port = /:\d{1,5}$/u.test(match[0]);
    // `//host/…`: a URL without its scheme.
    const schemeless =
      !userAt &&
      text.slice(start - 2, start) === '//' &&
      !/[A-Za-z0-9+.-]:$/u.test(text.slice(0, start - 2)) &&
      text[start - 3] !== '/' &&
      hasRootZoneTld(host);
    if (!userAt && !port && !schemeless) continue;
    if (text[start - 1] === '.') continue;
    if (
      userAt &&
      restoredAddresses.has(match[0].replace(/:\d{1,5}$/u, '').toLowerCase())
    )
      continue;
    if (port && !userAt && fileAndLine(text, start, host)) continue;
    addHost(hosts, host);
  }
  for (const match of text.matchAll(
    /(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g,
  )) {
    const end = match.index + match[1].length;
    const spelled =
      text[match.index - 1] === '@' || /^:\d{1,5}(?!\d)/u.test(text.slice(end));
    if (spelled && validIpv4(match[1])) addHost(hosts, match[1]);
  }
  for (const match of text.matchAll(
    /(@)?\[([0-9a-f:.]*:[0-9a-f:.]+)\](:\d{1,5})?/gi,
  )) {
    if ((match[1] || match[3]) && validIpv6(match[2])) addHost(hosts, match[2]);
  }
  return [...hosts];
}

// The part of a tool input that can name a destination. Paths of the file a
// local tool reads or writes are not destinations.
const PATH_FIELDS = new Set(['file_path', 'notebook_path', 'path']);
export function destinationText(toolName, input) {
  const local = [
    'Read',
    'Edit',
    'MultiEdit',
    'Write',
    'NotebookEdit',
    'Grep',
    'Glob',
  ].includes(toolName);
  return JSON.stringify(input, (key, value) =>
    local && PATH_FIELDS.has(key) ? undefined : value,
  );
}

function hostMatches(host, pattern) {
  if (pattern.startsWith('*.'))
    return host === pattern.slice(2) || host.endsWith(pattern.slice(1));
  return host === pattern;
}

// The rule keys that apply to a vault entry, most specific first.
function ruleKeys({ token, entry }) {
  const name = entry.source?.startsWith('known:')
    ? entry.source.slice(6)
    : null;
  return [name, token, entry.type, '*'];
}

export function allowedHosts({ token, entry }, rules) {
  const hosts = new Set();
  for (const key of ruleKeys({ token, entry })) {
    if (key && Array.isArray(rules[key]))
      rules[key]
        .map((h) => String(h).toLowerCase())
        .filter((h) => !h.startsWith('mcp:'))
        .forEach((h) => hosts.add(h));
  }
  for (const [re, list] of PROVIDER_HOSTS)
    if (re.test(entry.value)) list.forEach((h) => hosts.add(h));
  return [...hosts];
}

// The MCP server of a tool named `mcp__<server>__<tool>`, lower-cased, or null.
export function mcpServerOf(toolName) {
  const match = /^mcp__([A-Za-z0-9_-]+?)__/u.exec(String(toolName ?? ''));
  return match ? match[1].toLowerCase() : null;
}

// True when the user signed a rule `<NAME|TOKEN|TYPE|*> mcp:<server>` for this
// value. Nothing else lets a real value into an MCP tool: hosts or loopback
// URLs the input happens to mention say nothing about where the server sends it.
export function mcpServerAllowed({ token, entry }, rules, server) {
  if (!server || !entry) return false;
  const wanted = `mcp:${server}`;
  return ruleKeys({ token, entry }).some(
    (key) =>
      key &&
      Array.isArray(rules[key]) &&
      rules[key].some((h) => String(h).toLowerCase() === wanted),
  );
}

// Wildcard DNS services that answer a name with the address written in it
// (their documented forms, exact suffix): `203.0.113.7.sslip.io`,
// `203-0-113-7.sslip.io`, `pm.203.0.113.7.sslip.io`, `pm-203-0-113-7.sslip.io`,
// IPv6 as `2001-db8--1.sslip.io`; the same on nip.io.
const ADDRESS_NAME_SUFFIXES = ['sslip.io', 'nip.io'];
// Anything these services could read as an address: a dotted or dashed run
// of four or more numbers (IPv4), a label of eight hex digits (nip.io's hex
// form) or a dashed IPv6 (a `--`, or three hex groups joined by dashes).
const ADDRESS_LIKE_V4 = /(?<![0-9])\d{1,3}(?:[.-]\d{1,3}){3,}(?![0-9])/gu;
const ADDRESS_LIKE_OTHER =
  /(?:^|[.-])[0-9a-f]{8}(?:$|[.-])|--|[0-9a-f]{1,4}-[0-9a-f]{1,4}-[0-9a-f]{1,4}/u;
const PREFIX_LABELS =
  /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*$/u;

// True when `value` is an IP address and `host` names exactly that server:
// the address itself (`203.0.113.7`, `[2001:db8::1]`, with any port) or its
// name on an address-mapping service above. The address is then where the
// call goes, not data sent elsewhere (the mirror of an email address used
// as data): the same value as data to that host (`-d ip=<IP>
// https://pm.<IP>.sslip.io/`) goes to the server at that address, which
// already has it. A mapping name counts only when the protected address is
// the ONLY address-like sequence in it, so the service cannot select
// another one (`198.51.100.9.x.<IP>.sslip.io` resolves to 198.51.100.9);
// any other name that merely contains the address
// (`203.0.113.7.evil.example`) is resolved by whoever owns that name.
function addressNamesHost(value, host) {
  const address = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, '');
  const v4 = validIpv4(address);
  if (!v4 && !validIpv6(address)) return false;
  if (host === address) return true;
  const suffix = ADDRESS_NAME_SUFFIXES.find((s) => host.endsWith(`.${s}`));
  if (!suffix) return false;
  const name = host.slice(0, -suffix.length - 1);
  const forms = v4
    ? [address, address.replace(/\./gu, '-')]
    : [address.replace(/:/gu, '-')];
  const form = forms.find(
    (f) =>
      name === f ||
      name.endsWith(`.${f}`) ||
      (v4 && f.includes('-') && name.endsWith(`-${f}`)),
  );
  if (!form) return false;
  const prefix = name.slice(0, name.length - form.length).replace(/[.-]$/u, '');
  if (prefix && !PREFIX_LABELS.test(prefix)) return false;
  // The protected address is the only address-like sequence in the name.
  if (v4) {
    const runs = name.match(ADDRESS_LIKE_V4) ?? [];
    if (runs.length !== 1 || runs[0] !== form) return false;
    return !ADDRESS_LIKE_OTHER.test(prefix);
  }
  return !/\d/u.test(prefix) && !ADDRESS_LIKE_OTHER.test(prefix);
}

// `host` with every restored value in it, in any case, replaced by its token.
export function maskedHost(host, restored, vault) {
  let out = String(host);
  for (const token of new Set(restored.map((r) => r.token))) {
    const value = String(vault.valueOf(token) ?? '');
    if (value.length < 4) continue;
    const pattern = value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    out = out.replace(new RegExp(pattern, 'giu'), token);
  }
  return out;
}

// A restored secret may only travel to hosts allowed for it. With no host in
// the text there is nothing to check here (a local script, a file edit);
// what could not be read is the caller's (shellDestinations' uncertain).
// `hosts` replaces the hosts found in `text` (the PreToolUse hook passes the
// ones it read from the command with the shell it runs in).
export function checkDestinations(
  restored,
  text,
  vault,
  rules,
  { hosts: given = null } = {},
) {
  const hosts = given ?? hostsIn(text);
  if (!hosts.length) return { ok: true, violations: [] };
  const violations = [];
  const seen = new Set();
  const reported = new Set();
  for (const r of restored) {
    if (seen.has(r.token)) continue;
    seen.add(r.token);
    const entry = vault.entryOf(r.token);
    if (!entry) continue;
    const allowed = allowedHosts({ token: r.token, entry }, rules);
    for (const host of hosts) {
      // A name with tokens in it is judged with their values in place.
      const named = containsToken(host)
        ? host.replace(TOKEN_RE, (token) => vault.valueOf(token) ?? token)
        : host;
      if (addressNamesHost(entry.value, named.toLowerCase())) continue;
      if (
        !allowed.some(
          (p) => hostMatches(host, p) || hostMatches(named.toLowerCase(), p),
        )
      ) {
        const name = entry.source?.startsWith('known:')
          ? entry.source.slice(6)
          : null;
        // A value inside a host name is shown as its token (the deny
        // reason reaches the model; host names are lower case, so the
        // value would not be recognised there).
        const shown = maskedHost(host, restored, vault);
        if (reported.has(`${r.token} ${shown}`)) continue;
        reported.add(`${r.token} ${shown}`);
        violations.push({
          token: r.token,
          name,
          host: shown,
          allowed,
        });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ---- sensitive files -----------------------------------------------------------

const KEY_FILE_RE =
  /(?:^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)(?!\.pub)|[^/]+\.(?:p12|pfx|jks|keystore|kdbx|ppk|tfstate|tfstate\.backup)|allow\.key|vault\.key|\.git-credentials|[._]netrc|\.pgpass|kubeconfig|\.kube\/config|\.aws\/credentials|\.docker\/config\.json)$/i;

// ZeroH's own keys: reading one would undo the masking itself, so these stay
// closed in every mode. (Everything else under ZEROH_HOME, session signing
// keys included, is closed by the settings guard.)
const ZEROH_KEY_FILE_RE = /(?:^|[\\/])(?:allow|vault)\.key$/iu;

export function isZeroHSecretPath(p) {
  return ZEROH_KEY_FILE_RE.test(String(p ?? ''));
}

// True when a shell command names one of ZeroH's own keys.
export function commandNamesZeroHSecret(command) {
  return String(command)
    .split(/[\s'"=<>|;&()]+/u)
    .some((word) => word && isZeroHSecretPath(word));
}

export function isSensitivePath(p, root = process.cwd()) {
  const s = String(p);
  const portable = s.replace(/\\/g, '/');
  if (KEY_FILE_RE.test(portable)) return true;
  if (/\.(?:pem|key)$/i.test(s)) {
    try {
      const abs = path.resolve(root, s);
      const head = readFileSync(abs, 'utf8').slice(0, 8192);
      return /PRIVATE KEY/.test(head);
    } catch {
      return /(?:^|\/)(?:private|priv|server|client)[^/]*\.(?:pem|key)$/i.test(
        portable,
      );
    }
  }
  return false;
}

const READERS =
  /\b(?:cat|less|more|head|tail|bat|strings|xxd|od|hexdump|base64|openssl|cp|scp|rsync|curl|wget|nc|tee|awk|sed|grep|rg)\b/;
const ENCODERS =
  /\|\s*(?:base64|xxd|od|hexdump|openssl|gzip|bzip2|xz|zstd|rev|tr|gpg)\b|\b(?:base64|xxd|od|hexdump)\s+[^|;&]*\.env/;

export function bashSensitiveReason(command, root = process.cwd()) {
  const cmd = String(command);
  if (READERS.test(cmd)) {
    for (const word of cmd.split(/[\s'"=<>|;&()]+/)) {
      if (word && isSensitivePath(word, root))
        return `reads ${word}, a private key or credential store`;
    }
  }
  if (/\.env\b/.test(cmd) && ENCODERS.test(cmd))
    return 'pipes a secrets file into an encoder, which would slip past masking';
  return null;
}

const POWERSHELL_FILE_COMMANDS =
  /\b(?:Get-Content|gc|cat|type|Copy-Item|Set-Content|Out-File|Add-Content|Remove-Item)\b/i;

export function powershellSensitiveReason(command, root = process.cwd()) {
  const cmd = String(command);
  if (!POWERSHELL_FILE_COMMANDS.test(cmd)) return null;
  for (const word of cmd.split(/[\s'"=<>|;&(){}]+/)) {
    if (word && isSensitivePath(word, root))
      return `touches ${word}, a private key or credential store`;
  }
  return null;
}
