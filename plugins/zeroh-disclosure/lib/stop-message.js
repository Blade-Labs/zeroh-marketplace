// SPDX-License-Identifier: AGPL-3.0-only

// The message shown when UserPromptSubmit stops a prompt (T-30): at most
// three plain lines, what was found and why it could not be masked, the
// masked copy to send instead, and whether the next prompt is masked. It never
// repeats the prompt or any value; provider names come only from the public
// prefix catalog (lib/detector.js providerLabel).
import { isSecretType } from './data-kinds.js';
import { providerLabel } from './detector.js';
import { PERSONAL_DATA_KINDS } from './pii/index.js';

const KIND_NAMES = {
  ...Object.fromEntries(
    PERSONAL_DATA_KINDS.map(({ type, name }) => [type, name]),
  ),
  PASSWORD: 'password',
  PRIVATE_KEY: 'private key',
  TOKEN: 'token',
};

// Why the prompt could not be sent for masking.
export const STOP_REASONS = Object.freeze({
  'not-ready': "masking isn't ready yet in this session",
  off: 'the ZeroH proxy is off',
  provider: "Bedrock, Vertex and Foundry traffic doesn't pass the ZeroH proxy",
  overridden:
    "ANTHROPIC_BASE_URL is set outside ZeroH, so the ZeroH proxy isn't used",
  'no-login-item': "the ZeroH proxy can't keep running on this system",
  'not-set-up': "ZeroH couldn't put this session behind its proxy",
  'not-applied': "Claude Code didn't switch this session to the ZeroH proxy",
  unreachable: "the ZeroH proxy isn't reachable",
});

function withArticle(label) {
  return /^(?:[aeiou]|IBAN\b)/iu.test(label) ? `an ${label}` : `a ${label}`;
}

// A human name for one value of `type`, never derived from its characters
// beyond the public prefix catalog and rule names.
export function kindName(type, value) {
  if (isSecretType(type)) {
    let label = null;
    try {
      label = providerLabel(value);
    } catch {
      label = null;
    }
    if (label) return label;
  }
  const key = String(type || '').toUpperCase();
  if (KIND_NAMES[key]) return KIND_NAMES[key];
  if (isSecretType(key)) return 'secret';
  return key.toLowerCase().replace(/_/gu, ' ') || 'sensitive value';
}

// "a Stripe live secret key", "a Stripe live secret key and an email
// address", "a GitHub personal access token (×2)".
export function describeValues(values = []) {
  const counts = new Map();
  const seen = new Set();
  for (const { type, value } of values) {
    if (value != null && seen.has(value)) continue;
    if (value != null) seen.add(value);
    const name = kindName(type, value);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const parts = [...counts].map(
    ([name, count]) => `${withArticle(name)}${count > 1 ? ` (×${count})` : ''}`,
  );
  if (!parts.length) return 'a secret or personal value';
  if (parts.length === 1) return parts[0];
  const shown = parts.slice(0, 3);
  const rest = parts.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

function pasteKey(platform) {
  if (platform === 'darwin') return '⌘V';
  if (platform === 'win32') return 'Ctrl+V';
  return 'Ctrl+Shift+V';
}

function withText(lead, text) {
  return String(text).includes('\n') ? `${lead}\n${text}` : `${lead} ${text}`;
}

// The stop message. `files` are @-mentioned files holding values: Claude
// Code attaches them as they are, so no masked copy can be offered.
export function stopMessage({
  values = [],
  files = [],
  reason = 'unreachable',
  masked = null,
  copied = false,
  nextMasked = false,
  platform = process.platform,
}) {
  const lines = [];
  if (files.length) {
    const [file] = files;
    const count = files.reduce((sum, f) => sum + f.count, 0);
    lines.push(
      `🛡 ZeroH stopped this prompt: @${file.path}${files.length > 1 ? ` and ${files.length - 1} more` : ''} ${files.length > 1 ? 'hold' : 'holds'} ${count} secret or personal ${count === 1 ? 'value' : 'values'}, and Claude Code attaches mentioned files unmasked.`,
      'Remove the @ and ask Claude to read the file instead: what it reads is masked.',
    );
  } else {
    lines.push(
      `🛡 ZeroH stopped this prompt: it contains ${describeValues(values)}, and ${STOP_REASONS[reason] ?? STOP_REASONS.unreachable}.`,
    );
    if (masked && copied) {
      lines.push(
        withText(
          `A masked copy is on your clipboard (${pasteKey(platform)}, then Enter):`,
          masked,
        ),
      );
    } else if (masked) {
      lines.push(withText('Paste this instead:', masked));
    }
  }
  if (nextMasked) {
    lines.push(
      'From your next prompt on, typed secrets are masked automatically.',
    );
  }
  return lines.join('\n');
}
