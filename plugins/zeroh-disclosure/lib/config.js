// SPDX-License-Identifier: AGPL-3.0-only

// Configuration loading: the environment, then the user's
// <ZEROH_HOME>/config.env, then a repository's allowlisted .zeroh.env.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { zerohHome } from './vault.js';
import {
  DEFAULT_RECEIPT_RETENTION,
  shorterRetention,
  validRetention,
} from './receipt-retention.js';

// Minimal .env loader with no external deps. Reads, in order of decreasing
// precedence:
//   1. real environment variables (already in process.env — never overwritten)
//   2. <ZEROH_HOME>/config.env    (the user's own settings, every key)
//   3. <project>/.zeroh.env       (a repository's settings, allowlisted keys)
//
// A cloned repository is not trusted: its .zeroh.env may only set the
// display settings in PROJECT_SETTINGS, or tighten a protection. Paths, the
// proxy switch and anything that weakens protection come only from the
// user's environment or <ZEROH_HOME>/config.env. ZEROH_HOME itself comes only
// from the environment, so the hooks and the proxy daemon always use the
// same home.
//
// Lines starting with # are comments. KEY=VALUE pairs. Values may be wrapped
// in single or double quotes, which are stripped. `export KEY=VALUE` works
// (the `export ` prefix is ignored) so you can `source` the same file in a
// shell if you want.

// Settings a repository may choose freely: they change what the user sees on
// screen or how long local mappings are kept, never what reaches the model or
// where a value may go.
export const PROJECT_SETTINGS = Object.freeze([
  'ZEROH_BANNER',
  'ZEROH_DISPLAY_REAL_VALUES',
  'ZEROH_VAULT_RETENTION',
]);

// Settings a repository may only set to their strictest value.
const PROJECT_TIGHTENING = Object.freeze({ ZEROH_MASK_PII: ['on'] });

// Settings a repository may only shorten (D-16): the user's value, else the
// default, stands unless the repository's is shorter.
const PROJECT_SHORTEN_ONLY = new Set(['ZEROH_RECEIPT_RETENTION']);

// Never read from any file.
const ENVIRONMENT_ONLY = new Set(['ZEROH_HOME']);

let loaded = null;

function projectSettingAllowed(key, value) {
  if (PROJECT_SETTINGS.includes(key)) return true;
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return Boolean(PROJECT_TIGHTENING[key]?.includes(normalized));
}

function userConfigPath(env = process.env) {
  return path.join(zerohHome(env), 'config.env');
}

export async function loadConfig({ cwd = process.cwd() } = {}) {
  if (loaded) return loaded;
  const base = cwd || process.cwd();
  const ignored = new Set();
  const sources = [
    { file: userConfigPath(), project: false },
    { file: path.join(base, '.zeroh.env'), project: true },
  ];
  const values = {};
  const shorten = {};
  for (const { file, project } of sources) {
    const parsed = await readEnvFile(file);
    for (const [key, value] of Object.entries(parsed)) {
      if (project && PROJECT_SHORTEN_ONLY.has(key)) {
        if (validRetention(value)) shorten[key] = validRetention(value);
        else ignored.add(key);
        continue;
      }
      if (
        ENVIRONMENT_ONLY.has(key) ||
        (project && !projectSettingAllowed(key, value))
      ) {
        if (project) ignored.add(key);
        continue;
      }
      if (!Object.hasOwn(values, key)) values[key] = value;
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (!(key in process.env) || process.env[key] === '') {
      process.env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(shorten)) {
    const current =
      validRetention(process.env[key]) ?? DEFAULT_RECEIPT_RETENTION;
    process.env[key] = shorterRetention(current, value);
  }
  loaded = { ignored: [...ignored] };
  return loaded;
}

// One user-facing line naming what a repository tried to set, or null.
export function configWarning(result = loaded) {
  if (!result?.ignored?.length) return null;
  return `ZeroH Disclosure ignored ${result.ignored.join(', ')} from .zeroh.env: a repository may only set ${PROJECT_SETTINGS.join(', ')} or tighten a protection. Put other settings in your environment or ${userConfigPath()}.`;
}

async function readEnvFile(p) {
  let raw;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return {};
    throw e;
  }
  const out = {};
  for (const lineRaw of raw.split(/\r?\n/)) {
    let line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
