// SPDX-License-Identifier: AGPL-3.0-only

// Local diagnostic reports for local proxy failures: written to
// <ZEROH_HOME>/reports/proxy-<timestamp>.json (mode 0600) and never sent
// anywhere. A report says what failed, which recovery steps ran and how long
// they took, and the shape of the proxy's record. It holds no values, keys,
// tokens, prompts, file contents, project paths, host names or user names:
// every URL is reduced to a kind, and every free-text field is a fixed code.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLoopbackHost } from './loopback.js';
import * as store from './report-store.js';

const REPORT_ID_RE = /^proxy-\d{8}T\d{9}Z-[0-9a-f]{6}$/u;
const CODE_RE = /^[A-Za-z0-9_.:-]{1,64}$/u;

// The daemon runs from a copy of lib/ without .claude-plugin/; its copy
// carries build.json instead.
function pluginVersion() {
  for (const relative of ['../.claude-plugin/plugin.json', '../build.json']) {
    try {
      return JSON.parse(
        readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'),
      ).version;
    } catch {
      // Try the next place.
    }
  }
  return null;
}

function code(value) {
  return typeof value === 'string' && CODE_RE.test(value) ? value : null;
}

export function isProxyReportId(id) {
  return REPORT_ID_RE.test(String(id));
}

// What kind of URL this is, never the URL itself.
export function urlKind(value) {
  if (value === undefined || value === null || value === '') return 'none';
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    return 'invalid';
  }
  if (isLoopbackHost(parsed.hostname)) {
    return parsed.protocol === 'http:' && parsed.pathname.startsWith('/z/')
      ? 'zeroh-proxy'
      : 'loopback-other';
  }
  if (parsed.hostname === 'api.anthropic.com') return 'anthropic';
  return parsed.protocol === 'https:' ? 'custom-https' : 'custom-http';
}

function portOf(value) {
  try {
    const port = Number(new URL(String(value)).port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

// Where the settings file is, without the project path or user name.
export function settingsFileLabel(settingsPath, env = process.env) {
  if (!settingsPath) return null;
  const resolved = path.resolve(String(settingsPath));
  const base = path.basename(resolved);
  const safeBase = /^[A-Za-z0-9._-]{1,64}$/u.test(base) ? base : '<file>';
  const home = env.HOME || env.USERPROFILE;
  if (home && resolved === path.join(path.resolve(home), '.claude', base)) {
    return `~/.claude/${safeBase}`;
  }
  if (path.basename(path.dirname(resolved)) === '.claude') {
    return `<project>/.claude/${safeBase}`;
  }
  return `<custom>/${safeBase}`;
}

function installSummary(install, env) {
  if (!install || typeof install !== 'object') return null;
  return {
    settings_file: settingsFileLabel(install.settingsPath, env),
    original_base_url: install.originalBaseUrlPresent
      ? urlKind(install.originalBaseUrlValue)
      : 'none',
    created_env: Boolean(install.createdEnv),
    upstream: urlKind(install.upstream),
    proxy_url: urlKind(install.proxyUrl),
    proxy_port: portOf(install.proxyUrl),
    installed_at: code(String(install.installedAt || '')),
  };
}

function stepSummary(step) {
  const out = { step: code(step?.step) || 'unknown' };
  if (typeof step?.ok === 'boolean') out.ok = step.ok;
  for (const name of ['ms', 'found', 'status']) {
    if (Number.isFinite(step?.[name])) out[name] = Math.round(step[name]);
  }
  if (step?.code !== undefined) out.code = code(String(step.code));
  return out;
}

function shellName(env) {
  const shell = env.SHELL || env.ComSpec || '';
  const base = path.basename(String(shell)).replace(/\.exe$/iu, '');
  return /^[A-Za-z0-9_.-]{1,32}$/u.test(base) ? base : null;
}

export function buildProxyDiagnostic({
  env = process.env,
  event,
  failure = null,
  steps = [],
  install = null,
  baseUrl,
  proxy = {},
  now = new Date(),
}) {
  const stamp = now.toISOString().replace(/[-:.]/gu, '');
  return {
    kind: 'proxy',
    id: `proxy-${stamp}-${randomBytes(3).toString('hex')}`,
    date: now.toISOString(),
    event: code(event) || 'unknown',
    failure: code(failure),
    steps: steps.map(stepSummary),
    plugin_version: code(pluginVersion()),
    claude_code_version: code(env.CLAUDE_CODE_VERSION || '') || null,
    platform: process.platform,
    arch: process.arch,
    os_release: code(os.release()),
    node: process.version,
    shell: shellName(env),
    base_url: urlKind(baseUrl),
    install: installSummary(install, env),
    proxy: {
      port: Number.isInteger(proxy.port) ? proxy.port : null,
      daemon_answers:
        typeof proxy.daemonAnswers === 'boolean' ? proxy.daemonAnswers : null,
    },
  };
}

// Writes the report and returns its path, or null: a report never makes a
// recovery fail.
export function writeProxyDiagnostic(options) {
  try {
    const env = options.env || process.env;
    const report = buildProxyDiagnostic(options);
    return store.writeReport(report.id, report, {
      isId: isProxyReportId,
      env,
    });
  } catch {
    return null;
  }
}

export function listProxyReports({ env = process.env } = {}) {
  return store
    .listReports({ isId: isProxyReportId, env })
    .filter((report) => report.kind === 'proxy');
}

export function readProxyReport(id, { env = process.env } = {}) {
  const report = store.readReport(id, { isId: isProxyReportId, env });
  if (!report) throw new Error(`report not found: ${id}`);
  return report;
}

export function deleteProxyReport(id, { env = process.env } = {}) {
  return store.deleteReport(id, { isId: isProxyReportId, env });
}

// Paste-safe text for a GitHub issue or an email: rebuilt field by field
// from the fixed schema, so nothing hand-added to the file is echoed.
export function formatProxyReport(report) {
  const install = report.install || {};
  const lines = [
    `### ZeroH Disclosure proxy report ${code(report.id) || ''}`,
    '',
    `- date: ${code(String(report.date || '')) || '-'}`,
    `- event: ${code(report.event) || '-'}`,
    `- failure: ${code(report.failure) || '-'}`,
    `- plugin: ${code(report.plugin_version) || '-'} · Claude Code: ${code(report.claude_code_version) || 'unknown'}`,
    `- system: ${code(report.platform) || '-'} ${code(report.arch) || ''} ${code(report.os_release) || ''} · node ${code(report.node) || '-'} · shell ${code(report.shell) || '-'}`,
    `- ANTHROPIC_BASE_URL: ${code(report.base_url) || '-'}`,
    `- install: settings ${install.settings_file ? String(install.settings_file).replace(/[^\w./<>~-]/gu, '') : '-'}, upstream ${code(install.upstream) || '-'}, original ${code(install.original_base_url) || '-'}, proxy ${code(install.proxy_url) || '-'}`,
    '- steps:',
    ...(Array.isArray(report.steps) ? report.steps : []).map((step) => {
      const s = stepSummary(step);
      return `  - ${s.step}: ${s.ok === undefined ? '-' : s.ok ? 'ok' : 'failed'}${s.ms !== undefined ? ` (${s.ms} ms)` : ''}${s.code ? ` ${s.code}` : ''}`;
    }),
  ];
  return lines.join('\n');
}
