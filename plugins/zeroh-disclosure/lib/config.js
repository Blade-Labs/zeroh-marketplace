import { promises as fs } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// Minimal .env loader with no external deps. Reads, in order of decreasing
// precedence:
//   1. real environment variables (already in process.env — never overwritten)
//   2. <project>/.zeroh.env       (per-project override)
//   3. <plugin>/.env              (installation default)
//
// Lines starting with # are comments. KEY=VALUE pairs. Values may be wrapped
// in single or double quotes, which are stripped. `export KEY=VALUE` works
// (the `export ` prefix is ignored) so you can `source` the same file in a
// shell if you want.

const PLUGIN_ROOT = path.resolve(url.fileURLToPath(new URL('..', import.meta.url)));

let loaded = false;

export async function loadConfig({ cwd = process.cwd() } = {}) {
  if (loaded) return;
  loaded = true;
  const projectEnv = path.join(cwd, '.zeroh.env');
  const pluginEnv = path.join(PLUGIN_ROOT, '.env');
  for (const p of [projectEnv, pluginEnv]) {
    const parsed = await readEnvFile(p);
    for (const [k, v] of Object.entries(parsed)) {
      if (!(k in process.env) || process.env[k] === '') process.env[k] = v;
    }
  }
}

export function pluginRoot() {
  return PLUGIN_ROOT;
}

async function readEnvFile(p) {
  let raw;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
