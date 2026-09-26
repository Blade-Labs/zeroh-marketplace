// SPDX-License-Identifier: AGPL-3.0-only

// Report a missed value: masks the value from now on and saves a shape-only
// report (type, prefix, length, character classes) on this machine.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectSensitiveData, shannonEntropy, TOKEN_RE } from './detector.js';
import { PERSONAL_DATA_KINDS } from './pii/index.js';
import * as store from './report-store.js';
import { Vault } from './vault.js';

const MIN_VALUE_LENGTH = 8;
const MAX_VALUE_LENGTH = 4096;
const MAX_CONTEXT_LENGTH = 512;
const REPORT_ID_RE = /^[0-9a-f-]{36}$/u;
const TYPES = new Set([
  ...PERSONAL_DATA_KINDS.map(({ type }) => type),
  'ACCOUNT_NUMBER',
  'API_KEY',
  'CREDIT_CARD',
  'PASSWORD',
  'PERSON',
  'PHONE',
  'PRIVATE_KEY',
  'SECRET',
  'TOKEN',
]);

const CATALOG = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./rules/gitleaks.generated.json', import.meta.url)),
    'utf8',
  ),
);
const PLUGIN_VERSION = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url)),
    'utf8',
  ),
).version;

// Public prefixes are deliberately narrower than the detector catalog. Every
// item is a fixed provider discriminator, never a value-derived substring, and
// is kept only while a catalog rule still names it as a keyword.
const CATALOG_KEYWORDS = CATALOG.rules.flatMap((rule) =>
  (rule.keywords ?? []).map((keyword) => String(keyword).toLowerCase()),
);
const CANDIDATE_PREFIXES = [
  'github_pat_',
  'ghp_',
  'glpat-',
  'sk_live_',
  'rk_live_',
  'npm_',
  'AKIA',
  'ASIA',
];
export const PUBLIC_PREFIXES = Object.freeze(
  CANDIDATE_PREFIXES.filter((prefix) =>
    CATALOG_KEYWORDS.some((keyword) =>
      prefix.toLowerCase().startsWith(keyword),
    ),
  ),
);

const ROTATION_HINTS = Object.freeze([
  {
    prefixes: ['github_pat_', 'ghp_'],
    text: 'Revoke it at https://github.com/settings/tokens.',
  },
  {
    prefixes: ['glpat-'],
    text: 'Revoke it at https://gitlab.com/-/user_settings/personal_access_tokens.',
  },
  {
    prefixes: ['sk_live_', 'rk_live_'],
    text: 'Roll it at https://dashboard.stripe.com/apikeys.',
  },
  {
    prefixes: ['npm_'],
    text: 'Revoke it at https://www.npmjs.com/settings/~/tokens.',
  },
  {
    prefixes: ['AKIA', 'ASIA'],
    text: 'Deactivate it in AWS IAM (https://console.aws.amazon.com/iam/) and review its activity.',
  },
]);

export function validateMissInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('report_missed_secret requires an object input');
  }
  const value = input.value;
  if (typeof value !== 'string') {
    throw new Error('value must be a string');
  }
  if (value.length < MIN_VALUE_LENGTH || value.length > MAX_VALUE_LENGTH) {
    throw new Error('value must be between 8 and 4096 characters');
  }
  if (!value.trim()) throw new Error('value must not be all whitespace');
  if (new RegExp(TOKEN_RE.source, 'u').test(value)) {
    throw new Error('value is already a ZeroH token; nothing to mask');
  }
  const where = requiredContext(input.where, 'where');
  const why = requiredContext(input.why, 'why');
  if (
    input.type_guess !== undefined &&
    (typeof input.type_guess !== 'string' || input.type_guess.length > 64)
  ) {
    throw new Error('type_guess must be a string of at most 64 characters');
  }
  return {
    value,
    typeGuess: input.type_guess,
    where,
    why,
  };
}

function requiredContext(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  if (value.length > MAX_CONTEXT_LENGTH) {
    throw new Error(`${name} must be at most ${MAX_CONTEXT_LENGTH} characters`);
  }
  return value.trim();
}

export function publicPrefix(value) {
  return PUBLIC_PREFIXES.find((prefix) => value.startsWith(prefix)) ?? null;
}

function inferredType(value, typeGuess) {
  const normalized = String(typeGuess || '')
    .trim()
    .toUpperCase()
    .replace(/[ -]+/gu, '_');
  if (TYPES.has(normalized)) return normalized;
  const exact = detectSensitiveData(value, { profile: 'prompt' }).find(
    (finding) => finding.start === 0 && finding.end === value.length,
  );
  if (exact?.type && TYPES.has(exact.type)) return exact.type;
  return publicPrefix(value) ? 'API_KEY' : 'SECRET';
}

function characterClasses(value) {
  return {
    lowercase: /[a-z]/u.test(value),
    uppercase: /[A-Z]/u.test(value),
    digits: /\d/u.test(value),
    symbols: /[^A-Za-z0-9\s]/u.test(value),
    whitespace: /\s/u.test(value),
  };
}

function entropyBand(value) {
  const entropy = shannonEntropy(value);
  if (entropy < 3) return 'low';
  if (entropy < 4.3) return 'medium';
  return 'high';
}

function commonPrefixLength(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

function nearestRule(value) {
  const exact = detectSensitiveData(value, { profile: 'secrets' }).find(
    (finding) => finding.start === 0 && finding.end === value.length,
  );
  if (exact) {
    return {
      id: exact.ruleId ?? `local-${exact.type.toLowerCase()}`,
      why_not_matched:
        'The current detector matches this value; it may have appeared outside inspected text.',
    };
  }

  let nearest = null;
  for (const rule of CATALOG.rules) {
    for (const keyword of rule.keywords ?? []) {
      const score = commonPrefixLength(value, String(keyword));
      if (score >= 3 && (!nearest || score > nearest.score)) {
        nearest = { rule, score };
      }
    }
  }
  if (!nearest) return null;
  return {
    id: nearest.rule.id,
    why_not_matched: whyRuleMissed(nearest.rule, value),
  };
}

function whyRuleMissed(rule, value) {
  let matched = null;
  try {
    matched = new RegExp(
      rule.regex,
      String(rule.flags || '').replace('g', ''),
    ).exec(value);
  } catch {
    matched = null;
  }
  if (!matched) {
    return 'The value starts like this rule but its length or character shape does not fit the rule pattern.';
  }
  const secret = matched[1] ?? matched[0];
  if (rule.entropy !== undefined && shannonEntropy(secret) < rule.entropy) {
    return 'The value fits the rule pattern but its character entropy is below the rule threshold.';
  }
  return 'The value fits the rule pattern on its own; the surrounding text probably broke the match.';
}

function safeContext(text, value) {
  let safe = String(text).split(value).join('[reported value]');
  const findings = detectSensitiveData(safe, { profile: 'prompt' }).sort(
    (left, right) => right.start - left.start,
  );
  for (const finding of findings) {
    safe = `${safe.slice(0, finding.start)}[sensitive]${safe.slice(finding.end)}`;
  }
  return safe.slice(0, MAX_CONTEXT_LENGTH);
}

function fileExtension(where) {
  const match = where.match(/\bfile\s+(?:["']?)([^\s"']+)/iu);
  if (!match) return null;
  const name = path.basename(match[1].replace(/[,:;.)]+$/u, ''));
  const extension = path.extname(name);
  if (extension) return extension.toLowerCase();
  return /^\.[A-Za-z0-9_-]+$/u.test(name) ? name.toLowerCase() : null;
}

function isReportId(id) {
  return REPORT_ID_RE.test(String(id));
}

export function reportMiss(
  input,
  {
    cwd = process.cwd(),
    env = process.env,
    now = () => new Date(),
    id = randomUUID(),
  } = {},
) {
  const { value, typeGuess, where } = validateMissInput(input);
  const type = inferredType(value, typeGuess);
  const vault = new Vault(cwd, { env });
  const source = `reported:${id}`;
  const token = vault.tokenFor(type, value, source);
  const entry = vault.entryOf(token);
  if (entry?.source !== source) {
    vault.record(token, { ...entry, source });
  }
  vault.save();

  const safeWhere = safeContext(where, value);
  const report = {
    id,
    date: now().toISOString(),
    type,
    shape: {
      public_prefix: publicPrefix(value),
      length: value.length,
      character_classes: characterClasses(value),
      entropy_band: entropyBand(value),
    },
    detector: nearestRule(value),
    where: safeWhere,
    file_extension: fileExtension(safeWhere),
    plugin_version: PLUGIN_VERSION,
    claude_code_version: env.CLAUDE_CODE_VERSION || null,
  };
  store.writeReport(id, report, { isId: isReportId, env });
  return {
    id,
    token,
    report,
    resultText: resultText(token, value),
  };
}

export function resultText(token, value) {
  const prefix = publicPrefix(value);
  const hint = ROTATION_HINTS.find((entry) => entry.prefixes.includes(prefix));
  return `Masked from now on as ${token}. Anything already sent can't be recalled: rotate this credential.${hint ? ` ${hint.text}` : ''}`;
}

export function listReports({ env = process.env } = {}) {
  return store.listReports({ isId: isReportId, env }).map(reportView);
}

export function readReport(id, { env = process.env } = {}) {
  const report = store.readReport(id, { isId: isReportId, env });
  if (!report) throw new Error(`report not found: ${id}`);
  return reportView(report);
}

export function deleteReport(id, { env = process.env } = {}) {
  return store.deleteReport(id, { isId: isReportId, env });
}

// CLI callers receive only the schema this module writes. Unknown fields in a
// hand-edited report are never reflected to stdout.
function reportView(report) {
  return {
    id: String(report.id),
    date: String(report.date),
    type: TYPES.has(report.type) ? report.type : null,
    shape: {
      public_prefix:
        report.shape?.public_prefix === null
          ? null
          : PUBLIC_PREFIXES.includes(report.shape?.public_prefix)
            ? report.shape.public_prefix
            : null,
      length: Number(report.shape?.length),
      character_classes: Object.fromEntries(
        ['lowercase', 'uppercase', 'digits', 'symbols', 'whitespace'].map(
          (name) => [name, report.shape?.character_classes?.[name] === true],
        ),
      ),
      entropy_band: ['low', 'medium', 'high'].includes(
        report.shape?.entropy_band,
      )
        ? report.shape.entropy_band
        : null,
    },
    detector:
      report.detector && typeof report.detector === 'object'
        ? {
            id: String(report.detector.id),
            why_not_matched: String(report.detector.why_not_matched),
          }
        : null,
    where: String(report.where),
    file_extension:
      report.file_extension === null ? null : String(report.file_extension),
    plugin_version: String(report.plugin_version),
    claude_code_version:
      report.claude_code_version === null
        ? null
        : String(report.claude_code_version),
  };
}
