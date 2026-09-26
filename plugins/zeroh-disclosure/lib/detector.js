// SPDX-License-Identifier: AGPL-3.0-only

// Pattern detector. Three profiles:
//   prompt  — secrets and personal data; used on text the user writes.
//   tool    — the same, without national-format phone numbers; used on tool
//             output, where digit groups are usually code, sizes or times.
//   secrets — secrets only.
// Personal data is detected by vendored libraries (lib/pii). No rule detects
// names or currency amounts.
// A rule with `group` masks only that capture group (the value after a key
// name, the password inside a URL), so the surrounding text stays readable.

import {
  findPersonalData,
  LIBPHONENUMBER_VERSION,
  PERSONAL_DATA_KINDS,
  phoneRegion,
  PII_RULES,
  TLD_VERSION,
  VALIDATOR_VERSION,
} from './pii/index.js';
import { TOKEN_RE } from './token-pattern.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GITLEAKS_CATALOG = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./rules/gitleaks.generated.json', import.meta.url)),
    'utf8',
  ),
);

const SECRET_NAME =
  '(?:PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|API[_-]?KEY|APIKEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CLIENT[_-]?SECRET|AUTH[_-]?KEY|CREDENTIALS?)';

// A key that is only a secret word (`password: …`, `token = …`). Kept to exact
// words so `tokenizer:`, `secrets: inherit` or `credentials: include` stay text.
const BARE_SECRET_NAME =
  '(?:PASSWORD|PASSWD|PASSPHRASE|PWD|SECRET(?:[_-]?KEY)?|(?:ACCESS[_-]?|AUTH[_-]?|API[_-]?)?TOKEN|API[_-]?KEY|APIKEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CLIENT[_-]?SECRET|AUTH[_-]?KEY)';

// Type names and keywords that follow a secret-named key in code and schemas
// (`password: string;`, `token: Optional`), never a value.
const TYPE_WORDS = new Set([
  'string',
  'str',
  'number',
  'boolean',
  'bool',
  'int',
  'integer',
  'bytes',
  'object',
  'unknown',
  'optional',
  'required',
  'secretstr',
  'string?',
  'text',
  'varchar',
  'char',
  'buffer',
  'uint8array',
]);
const SECRET_WORD_RE =
  /password|passwd|passphrase|secret|token|api_?key|apikey/i;

// True when the text after a secret-named key is code or a name, not a value.
// Real secrets and passwords carry digits or symbols; what follows a
// secret-named key in code is almost always one of these instead:
//   - a path, a subshell, a template or format placeholder, a reference,
//     a YAML tag or alias, a parameter list, an array, a generic type or an
//     ABNF repetition (`/run/x`, `$(pwd)`, `${X}`, `%s`, `!Ref`, `*alias`,
//     `(scopes`, `[queryRange]`, `<string>]`, `1*tchar`);
//   - an identifier, member access or constant name, with the non-null `!`,
//     `?`, `[]` or `;` code adds (`process.env.JWT_SECRET!`, `API_KEY`,
//     `CSSToken`, `tokenString`, `Foo[]`);
//   - a name made of words and separators: kebab-case headers, snake_case
//     error codes, namespaced events, CSS classes (`x-ms-session-token`,
//     `password_too_weak`, `msal:acquireTokenSuccess`);
//   - a call, index access or generic (`getpass(`, `headers[Name]`,
//     `Array<string>`);
//   - a package version or range (`^9.0.2`, `~1.40`, `>=3.2`).
// `words: false` keeps plain words (a letters-only value) as possible values,
// for rules whose key is unambiguous (a connection string's `Password=`).
export function looksLikeCodeValue(value, name = '', { words = true } = {}) {
  const v = String(value);
  if (/^(?:[/~]|\.\.?\/|\$\(|\$\{|\$[A-Za-z_]|[`!(<[@&*#%=]|\d*\*)/u.test(v))
    return true;
  const core = v.replace(/(?:\[\]|\(\)|[!?;:,>)])+$/u, '');
  if (!core) return true;
  if (TYPE_WORDS.has(core.toLowerCase())) return true;
  if (
    /^(?:[\^~]|[<>]=?|=)?v?\d+(?:\.(?:\d+|[xX*]))+(?:[-+][\w.-]+)?$/u.test(core)
  )
    return true;
  if (
    /^[A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*)*(?:\?\.)?[[(<]/u.test(
      core,
    )
  )
    return true;
  if (/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+$/u.test(core)) return true;
  if (words && /^[A-Za-z_$][A-Za-z_$.:-]*$/u.test(core)) return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(core)) {
    const last = String(name).split(/[.]/u).pop().replace(/["']/gu, '');
    // The key's own name, also with a bundler's numeric suffix
    // (`continuationToken: continuationToken2`).
    if (last && core.toLowerCase().replace(/\d+$/u, '') === last.toLowerCase())
      return true;
    const hit = SECRET_WORD_RE.exec(core);
    if (hit && hit.index > 0 && hit.index + hit[0].length === core.length) {
      const before = core[hit.index - 1];
      const first = core[hit.index];
      if (before === '_' || (/[a-z0-9]/u.test(before) && /[A-Z]/u.test(first)))
        return true;
    }
  }
  return false;
}

// Names that contain a secret word but never hold one.
const NON_SECRET_NAME =
  /(?:_URL|_URI|_PATH|_FILE|_DIR|_PREFIX|_SUFFIX|_TIMEOUT(?:_MS|_SECONDS)?|_TTL|_SCOPE|_HEADER|_NAME|_ID|_REGION|_ENDPOINT|MAX_\w*TOKENS?|_TOKENS|PUBLIC_?KEY|_ICON_KEY|_KEY_ID|TOKEN_TYPE|_LENGTH|_SIZE|_COUNT|_ENABLED|_MODE)$/i;

// Values that are placeholders, references or already tokens.
const PLACEHOLDER =
  /^(?:\$\{?[\w.-]+\}?|<[^>]*>|\[[A-Z_]+-[0-9a-f]{6}\]|x{3,}|\*{3,}|changeme|your[-_].*|example|placeholder|todo|null|none|true|false|undefined|redacted|\.\.\.)$/i;

export { TOKEN_RE };

// `group` value meaning "the first capture group that matched" (gitleaks).
const FIRST_NON_EMPTY = 'first';

function unquote(value) {
  return /^(["'`]).+\1$/su.test(value) ? value.slice(1, -1) : value;
}

// The value inside an imported rule's secret group: without quotes the group
// captured, and for a Kubernetes Secret without the `key: ` in front of it.
function secretInside(rule, value) {
  let offset = 0;
  let out = value;
  if (rule.id === 'kubernetes-secret-yaml') {
    const m = /^[\w.-]+:(?:[ \t]*(?:\||>[-+]?)\s+)?[ \t]*/u.exec(out);
    if (m) {
      offset += m[0].length;
      out = out.slice(m[0].length);
    }
  }
  if (unquote(out) !== out) {
    offset += 1;
    out = unquote(out);
  }
  return { value: out, offset };
}

function secretGroupIndex(rule, match) {
  const g = rule.group ?? 0;
  if (g !== FIRST_NON_EMPTY) return g;
  for (const i of rule.groups ?? []) if (match[i]) return i;
  return 0;
}

const SECRET_RULES = [
  {
    type: 'PRIVATE_KEY',
    risk: 'critical',
    pattern:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
    confidence: 0.99,
  },
  {
    type: 'PRIVATE_KEY',
    risk: 'critical',
    pattern: /\bAGE-SECRET-KEY-1[0-9A-Z]{58}\b/g,
    confidence: 0.99,
  },
  {
    type: 'PRIVATE_KEY',
    risk: 'critical',
    pattern: /PuTTY-User-Key-File-\d+:[\s\S]*?Private-MAC: [0-9a-f]+/g,
    confidence: 0.99,
  },
  // Provider formats (subset of the gitleaks rule set; fixed prefixes).
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bsk-ant-(?:api|admin|oat)\d{2}-[A-Za-z0-9_-]{20,}/g,
    confidence: 0.99,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g,
    confidence: 0.98,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bsk-or-v1-[a-f0-9]{40,}\b/g,
    confidence: 0.98,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bsk-lf-[0-9a-f-]{20,}\b/g,
    confidence: 0.95,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    confidence: 0.98,
  },
  {
    type: 'SECRET',
    risk: 'critical',
    pattern: /\bwhsec_[A-Za-z0-9+/=]{16,}/g,
    confidence: 0.97,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
    confidence: 0.99,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,
    confidence: 0.99,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
    confidence: 0.98,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    confidence: 0.97,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    confidence: 0.96,
  },
  {
    type: 'SECRET',
    risk: 'critical',
    pattern: /\bGOCSPX-[A-Za-z0-9_-]{20,}/g,
    confidence: 0.97,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
    confidence: 0.97,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bxapp-\d-[A-Za-z0-9-]{10,}/g,
    confidence: 0.97,
  },
  {
    type: 'SECRET',
    risk: 'critical',
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}/g,
    confidence: 0.98,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bhf_[A-Za-z0-9]{30,}\b/g,
    confidence: 0.96,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bgsk_[A-Za-z0-9]{40,}\b/g,
    confidence: 0.96,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/g,
    confidence: 0.97,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/g,
    confidence: 0.99,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bdckr_pat_[A-Za-z0-9_-]{20,}/g,
    confidence: 0.97,
  },
  {
    type: 'TOKEN',
    risk: 'critical',
    pattern: /\bhvs\.[A-Za-z0-9_-]{24,}/g,
    confidence: 0.96,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\btskey-(?:auth|api|client)-[A-Za-z0-9-]{20,}/g,
    confidence: 0.97,
  },
  {
    type: 'TOKEN',
    risk: 'critical',
    pattern: /\bsntrys_[A-Za-z0-9+/=_-]{40,}/g,
    confidence: 0.96,
  },
  {
    type: 'TOKEN',
    risk: 'critical',
    pattern: /\bglsa_[A-Za-z0-9_]{32,}/g,
    confidence: 0.96,
  },
  {
    type: 'TOKEN',
    risk: 'critical',
    pattern: /\bdop_v1_[a-f0-9]{64}\b/g,
    confidence: 0.98,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
    confidence: 0.97,
  },
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\bzhk_[0-9a-f]{16}_[A-Za-z0-9_-]{43}\b/g,
    confidence: 0.99,
  },
  {
    type: 'TOKEN',
    risk: 'critical',
    pattern: /\bops_[A-Za-z0-9_-]{40,}/g,
    confidence: 0.9,
  },
  {
    type: 'TOKEN',
    risk: 'critical',
    pattern: /\bdp\.(?:st|pt|sa|ct)\.[A-Za-z0-9_-]{30,}/g,
    confidence: 0.95,
  },
  // Legacy generic prefix rule from 0.1 (sk-/rk-/api-), without pk (publishable).
  {
    type: 'API_KEY',
    risk: 'critical',
    pattern: /\b(?:sk|rk|api)[-_](?:live|test|prod)?[-_]?[A-Za-z0-9_-]{24,}\b/g,
    confidence: 0.85,
  },
  // Shapes.
  {
    type: 'TOKEN',
    risk: 'critical',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    confidence: 0.95,
  },
  {
    type: 'TOKEN',
    risk: 'critical',
    pattern:
      /\b(?:Authorization|Proxy-Authorization)\s*:\s*(?:Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{12,})/gi,
    group: 1,
    confidence: 0.95,
  },
  {
    type: 'PASSWORD',
    risk: 'critical',
    pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@'"]+:([^\s@/'"]{3,})@/gi,
    group: 1,
    confidence: 0.95,
    // Not the documentation stand-ins (`user:pass@host`, `user:${PW}@host`).
    validate: (v) =>
      !PLACEHOLDER.test(v) &&
      !/^(?:pass(?:word)?|passwd|pwd|secret|pw)$/iu.test(v),
  },
  {
    type: 'PASSWORD',
    risk: 'critical',
    pattern:
      /(?:^|[;\s])(?:Password|Pwd|AccountKey|SharedAccessKey)=([^;\s'"]{4,})/gi,
    group: 1,
    confidence: 0.94,
    // Not `PWD=/home/me` from `env`, nor `pwd=$(pwd)`.
    // Nor a keyword argument (`password=None,`, `password=password)`).
    validate: (v) => {
      const core = v.includes('(') ? v : v.replace(/[,):]+$/u, '');
      return (
        !PLACEHOLDER.test(core) &&
        !/^(?:password|passwd|pwd|pass)$/iu.test(core) &&
        !looksLikeCodeValue(core, 'password', { words: false })
      );
    },
  },
  {
    type: 'TOKEN',
    risk: 'critical',
    pattern:
      /[?&](?:sig|X-Amz-Signature|X-Goog-Signature)=([A-Za-z0-9%/+=._-]{16,})/g,
    group: 1,
    confidence: 0.93,
  },
  {
    type: 'SECRET',
    risk: 'high',
    pattern: /\botpauth:\/\/[^\s'"]*secret=([A-Z2-7]{16,})/gi,
    group: 1,
    confidence: 0.97,
  },
  {
    type: 'PASSWORD',
    risk: 'high',
    pattern: /\$(?:2[aby]|argon2(?:id|i|d)|6|5)\$[^\s'"]{20,}/g,
    confidence: 0.93,
  },
  {
    // KEY=value, key: value, "apiKey": "value" where the key name is secret-shaped,
    // including a bare `password: …` or `token = …`. Key, separator and value sit
    // on one line. A random-looking value is the most certain case and is
    // masked like any other (DET-1); the value stops at a backslash, so an
    // escaped newline in a string (`KEY=value\nNEXT=…`) does not join lines.
    type: 'SECRET',
    risk: 'critical',
    pattern: new RegExp(
      `(?:^|[\\s{,;(])["']?([A-Za-z_][A-Za-z0-9_.-]*${SECRET_NAME}[A-Za-z0-9_]*|${BARE_SECRET_NAME})["']?[ \\t]*[:=][ \\t]*["']?([^\\s"',;}{)\\\\]{6,})`,
      'gim',
    ),
    group: 2,
    confidence: 0.9,
    validate: (value, match) =>
      !NON_SECRET_NAME.test(match[1]) &&
      !PLACEHOLDER.test(value) &&
      !looksLikeCodeValue(value, match[1]) &&
      !/^\d{1,7}$/.test(value) &&
      !/^https?:\/\/[^@]*$/.test(value),
    typeOf: (match) => nameType(match[1]),
    genericShape: true,
  },
];

// Indices of the unnamed capture groups in a regular expression source.
// Named groups (`(?<alg>…)` in jwt-base64) label alternatives; they never
// hold the secret.
function unnamedGroups(source) {
  const out = [];
  let index = 0;
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === '(') {
      if (source[i + 1] !== '?') out.push((index += 1));
      else if (source[i + 2] === '<' && !/[=!]/u.test(source[i + 3]))
        index += 1;
    }
  }
  return out;
}

// Imported rules follow gitleaks: the secret is `secretGroup` when the rule
// sets it, otherwise the first non-empty capture group, otherwise the whole
// match. Entropy, allowlists and the vault all see that secret, so the key
// name in front of it stays readable and a restore puts back only the value.
// `generic-api-key` and `hashicorp-tf-password` (whose `.tf` path condition
// the text-only detector cannot check) are keyed on secret-looking names, like
// the key-name rule, and are treated the same way (GENERIC_RULE_IDS). A secret
// group that captured its own quotes is trimmed to the value inside them.
const GENERIC_RULE_IDS = new Set(['generic-api-key', 'hashicorp-tf-password']);

const GITLEAKS_RULES = GITLEAKS_CATALOG.rules.map((rule) => {
  const pattern = new RegExp(rule.regex, rule.flags);
  return {
    ...rule,
    risk: 'critical',
    confidence: 0.84,
    pattern,
    group: rule.secretGroup ?? FIRST_NON_EMPTY,
    groups: unnamedGroups(pattern.source),
    imported: true,
    ...(GENERIC_RULE_IDS.has(rule.id)
      ? {
          genericShape: true,
          validate: (value) =>
            !PLACEHOLDER.test(unquote(value)) &&
            !looksLikeCodeValue(unquote(value)),
        }
      : {}),
    allowlists: (rule.allowlists ?? []).map((allowlist) => ({
      ...allowlist,
      regexes: (allowlist.regexes ?? []).map(
        (regex) => new RegExp(regex.regex, regex.flags),
      ),
    })),
  };
});

// Personal data is decided by vendored libraries only (lib/pii: validator.js,
// libphonenumber-js). The typed prompt and tool output use the same rules;
// national-format phone numbers (which need a default region) are looked for
// only in the typed prompt.
const PROFILES = {
  prompt: [...SECRET_RULES, ...GITLEAKS_RULES, ...PII_RULES],
  tool: [...SECRET_RULES, ...GITLEAKS_RULES, ...PII_RULES],
  secrets: [...SECRET_RULES, ...GITLEAKS_RULES],
};
const NATIONAL_PHONE_PROFILES = new Set(['prompt']);

function nameType(name) {
  const n = String(name).toUpperCase();
  if (/PASSWORD|PASSWD|PASSPHRASE|^PWD$/.test(n)) return 'PASSWORD';
  if (/PRIVATE[_-]?KEY/.test(n)) return 'PRIVATE_KEY';
  if (/TOKEN/.test(n)) return 'TOKEN';
  if (/API[_-]?KEY|APIKEY|ACCESS[_-]?KEY|AUTH[_-]?KEY|_KEY$|^KEY$/.test(n))
    return 'API_KEY';
  return 'SECRET';
}
export { nameType };

function score(f) {
  return (
    (f.imported ? 0 : 1000) +
    ({ critical: 100, high: 50, medium: 25, low: 10 }[f.risk] ?? 0) +
    f.confidence * 10 +
    f.length / 100
  );
}

export function shannonEntropy(value) {
  if (!value) return 0;
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isEntropyGuess(value) {
  return value.length >= 24 && shannonEntropy(value) >= 4.3;
}

function isKnownNegative(value) {
  return (
    /^(?:[a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{128})$/i.test(value) ||
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value,
    ) ||
    /^pk_(?:live|test)_/i.test(value) ||
    /^ssh-(?:ed25519|rsa|ecdsa)\s/i.test(value)
  );
}

function allowlisted(rule, value, match) {
  for (const allowlist of rule.allowlists ?? []) {
    // File and commit allowlists cannot be proven by the text-only detector.
    // Failing closed avoids suppressing a finding on a different path.
    if (allowlist.paths?.length || allowlist.commits?.length) continue;
    const target =
      allowlist.regexTarget === 'match'
        ? match[0]
        : allowlist.regexTarget === 'line'
          ? match.input.slice(
              match.input.lastIndexOf('\n', match.index) + 1,
              match.input.indexOf('\n', match.index) === -1
                ? match.input.length
                : match.input.indexOf('\n', match.index),
            )
          : value;
    const checks = [];
    if (allowlist.stopwords?.length) {
      checks.push(
        allowlist.stopwords.some((word) =>
          target.toLowerCase().includes(String(word).toLowerCase()),
        ),
      );
    }
    if (allowlist.regexes?.length) {
      checks.push(
        allowlist.regexes.some((regex) => {
          regex.lastIndex = 0;
          return regex.test(target);
        }),
      );
    }
    if (
      checks.length &&
      (allowlist.condition === 'AND'
        ? checks.every(Boolean)
        : checks.some(Boolean))
    ) {
      return true;
    }
  }
  return false;
}

function dedupe(fs) {
  const out = [];
  for (const f of fs) {
    const o = out.find((x) => f.start < x.end && x.start < f.end);
    if (!o) out.push(f);
    else if (
      (isCredentialFinding(f) && !isCredentialFinding(o)) ||
      (isCredentialFinding(f) &&
        isCredentialFinding(o) &&
        covers(f, o) &&
        !covers(o, f)) ||
      (isCredentialFinding(f) === isCredentialFinding(o) &&
        !(isCredentialFinding(f) && covers(o, f)) &&
        score(f) > score(o))
    ) {
      out[out.indexOf(o)] = f;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// Of two overlapping secrets, the one that covers the other masks all of it
// (`glpat-…` stops at a `.` the routable-token rule includes).
function covers(a, b) {
  return a.start <= b.start && b.end <= a.end;
}

function isCredentialFinding(finding) {
  return ['API_KEY', 'PASSWORD', 'TOKEN', 'PRIVATE_KEY', 'SECRET'].includes(
    finding.type,
  );
}

function tokenSpans(text) {
  const spans = [];
  TOKEN_RE.lastIndex = 0;
  for (const m of text.matchAll(TOKEN_RE))
    spans.push([m.index, m.index + m[0].length]);
  return spans;
}

export function detectSensitiveData(
  text,
  { enabledTypes = null, profile = 'prompt', region } = {},
) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const rules = PROFILES[profile] ?? PROFILES.prompt;
  const lowerText = text.toLowerCase();
  const tokens = tokenSpans(text);
  const insideToken = (s, e) => tokens.some(([a, b]) => s < b && a < e);
  const findings = [];
  const national = NATIONAL_PHONE_PROFILES.has(profile)
    ? region === undefined
      ? phoneRegion()
      : region
    : null;
  for (const rule of rules) {
    if (rule.find) {
      if (enabledTypes && !enabledTypes.includes(rule.type)) continue;
      for (const hit of findPersonalData(rule, text, {
        phoneRegion: national,
        profile,
      })) {
        if (insideToken(hit.start, hit.end)) continue;
        findings.push({
          type: rule.type,
          risk: rule.risk,
          start: hit.start,
          end: hit.end,
          length: hit.end - hit.start,
          confidence: hit.confidence,
          source: rule.source,
        });
      }
      continue;
    }
    if (
      rule.keywords?.length &&
      !rule.keywords.some((keyword) =>
        lowerText.includes(String(keyword).toLowerCase()),
      )
    ) {
      continue;
    }
    const pattern = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes('d')
        ? rule.pattern.flags
        : rule.pattern.flags + 'd',
    );
    for (const match of text.matchAll(pattern)) {
      const g = secretGroupIndex(rule, match);
      let value = match[g];
      if (!value) continue;
      let start = match.indices[g][0];
      let end = match.indices[g][1];
      if (rule.imported) {
        const inner = secretInside(rule, value);
        start += inner.offset;
        value = inner.value;
        end = start + value.length;
        if (!value) continue;
      }
      if (rule.validate && !rule.validate(value, match)) continue;
      // Hex digests and UUIDs are not secrets on their own; a provider rule
      // anchored on its own name (`MERAKI: <40 hex>`) still takes them.
      if ((!rule.imported || rule.genericShape) && isKnownNegative(value))
        continue;
      if (rule.entropy !== undefined && shannonEntropy(value) < rule.entropy)
        continue;
      if (allowlisted(rule, value, match)) continue;
      if (insideToken(start, end)) continue;
      const type = rule.typeOf ? rule.typeOf(match) : rule.type;
      if (enabledTypes && !enabledTypes.includes(type)) continue;
      findings.push({
        type,
        risk: rule.risk,
        start,
        end,
        length: value.length,
        confidence: rule.confidence,
        ...(rule.id ? { ruleId: rule.id } : {}),
        ...(rule.imported ? { imported: true } : {}),
        ...(rule.genericShape ? { generic: true } : {}),
      });
    }
  }
  return dedupe(findings.sort((a, b) => a.start - b.start || b.end - a.end));
}

// A random-looking value that no rule masked and that has no key-like name
// in front of it (a value next to TOKEN=, secret: … is masked by the key-name
// rules above). It is sent as is; the typed-prompt hook only warns.
// A run of base64/base64url characters; a URL path segment or a bare
// command argument counts as well.
const RANDOM_VALUE =
  /(?<![A-Za-z0-9+_=-])[A-Za-z0-9+_-]{24,}={0,2}(?![A-Za-z0-9+_=-])/g;
const KEY_BEFORE = /[A-Za-z_][A-Za-z0-9_.-]*["']?[ \t]*[:=][ \t]*["']?$/u;

export function detectEntropyWarnings(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const findings = detectSensitiveData(text, { profile: 'prompt' });
  const warnings = [];
  for (const match of text.matchAll(RANDOM_VALUE)) {
    const value = match[0];
    const start = match.index;
    const end = start + value.length;
    if (!/[A-Za-z]/u.test(value) || !/\d/u.test(value)) continue;
    if (isKnownNegative(value) || !isEntropyGuess(value)) continue;
    const before = text.slice(Math.max(0, start - 64), start);
    if (KEY_BEFORE.test(before)) continue;
    // The body of an SSH public key (`ssh-ed25519 AAAA… comment`).
    if (/(?:ssh-[a-z0-9]+|ecdsa-sha2-[a-z0-9]+)@?[\w.]*\s+$/u.test(before))
      continue;
    if (findings.some((f) => start < f.end && f.start < end)) continue;
    warnings.push({
      type: 'ENTROPY_WARNING',
      risk: 'warning',
      name: null,
      start,
      end,
      length: value.length,
      entropy: shannonEntropy(value),
      confidence: 0.5,
    });
  }
  return warnings;
}

export function detectorManifest() {
  const all = PROFILES.prompt;
  return {
    id: 'zeroh-disclosure-detector-v4',
    engine: 'regex-local',
    cloud_calls: false,
    categories: [
      ...new Map(
        all.map((r) => [
          r.type,
          { type: r.type, risk: r.risk, confidence: r.confidence },
        ]),
      ).values(),
    ],
    provider_catalog: {
      source: GITLEAKS_CATALOG.generatedFrom,
      imported: GITLEAKS_CATALOG.counts.imported,
      skipped: GITLEAKS_CATALOG.counts.skipped,
    },
  };
}

// Fixed provider names for public key prefixes. The note the proxy adds to a
// typed prompt uses only these catalog strings: a value selects a label, but no
// character of the value is ever copied into it.
const PROVIDER_PREFIXES = [
  ['sk_live_', 'Stripe live secret key'],
  ['sk_test_', 'Stripe test secret key'],
  ['rk_live_', 'Stripe live restricted key'],
  ['rk_test_', 'Stripe test restricted key'],
  ['whsec_', 'Stripe webhook signing secret'],
  ['sk-ant-', 'Anthropic API key'],
  ['sk-proj-', 'OpenAI project API key'],
  ['sk-svcacct-', 'OpenAI service account key'],
  ['sk-admin-', 'OpenAI admin key'],
  ['sk-or-v1-', 'OpenRouter API key'],
  ['sk-lf-', 'Langfuse secret key'],
  ['github_pat_', 'GitHub fine-grained personal access token'],
  ['ghp_', 'GitHub personal access token'],
  ['gho_', 'GitHub OAuth token'],
  ['ghu_', 'GitHub user-to-server token'],
  ['ghs_', 'GitHub server-to-server token'],
  ['ghr_', 'GitHub refresh token'],
  ['glpat-', 'GitLab personal access token'],
  ['AKIA', 'AWS access key ID'],
  ['ASIA', 'AWS temporary access key ID'],
  ['AIza', 'Google API key'],
  ['GOCSPX-', 'Google OAuth client secret'],
  ['xoxb-', 'Slack bot token'],
  ['xoxp-', 'Slack user token'],
  ['xapp-', 'Slack app-level token'],
  ['hf_', 'Hugging Face access token'],
  ['gsk_', 'Groq API key'],
  ['npm_', 'npm access token'],
  ['pypi-', 'PyPI API token'],
  ['dckr_pat_', 'Docker Hub personal access token'],
  ['hvs.', 'HashiCorp Vault token'],
  ['tskey-', 'Tailscale key'],
  ['sntrys_', 'Sentry token'],
  ['glsa_', 'Grafana service account token'],
  ['dop_v1_', 'DigitalOcean personal access token'],
  ['SG.', 'SendGrid API key'],
  ['ops_', '1Password service account token'],
  ['dp.', 'Doppler token'],
];

// What the free plugin detects, from the live rule set (T-35): provider key
// formats grouped by provider (the gitleaks rules, by the first word of their
// id), the public prefixes ZeroH names, and the personal-data kinds. The
// `about` skill and `zeroh-disclosure catalog` print this, so answers about
// coverage never drift from the code.
export function detectionCatalog() {
  const providers = new Map();
  for (const rule of GITLEAKS_CATALOG.rules) {
    const provider = String(rule.id).split('-')[0] || rule.id;
    if (!providers.has(provider)) providers.set(provider, []);
    providers.get(provider).push(rule.id);
  }
  const secretTypes = new Set([
    'API_KEY',
    'SECRET',
    'TOKEN',
    'PASSWORD',
    'PRIVATE_KEY',
  ]);
  return {
    source: `gitleaks ${GITLEAKS_CATALOG.generatedFrom.version}`,
    provider_formats: GITLEAKS_CATALOG.rules.length,
    providers: [...providers]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, rules]) => ({ name, rules: rules.sort() })),
    named_prefixes: PROVIDER_PREFIXES.map(([prefix, label]) => ({
      prefix,
      label,
    })),
    also: [
      'values from .env files and credential files in the project (exact match, also when encoded)',
      'secrets next to key-like names (API_KEY=..., "password": ..., token: ...)',
      'private keys (PEM, OpenSSH, PuTTY, age)',
    ],
    personal_data: detectorManifest()
      .categories.map(({ type }) => type)
      .filter((type) => !secretTypes.has(type))
      .sort(),
    personal_data_kinds: PERSONAL_DATA_KINDS.map(({ type, label, source }) => ({
      type,
      label,
      source,
    })),
    personal_data_sources: [
      `validator.js ${VALIDATOR_VERSION}`,
      `libphonenumber-js ${LIBPHONENUMBER_VERSION}`,
      `IANA top-level domains ${TLD_VERSION}`,
      'ISO 3166-1 numeric codes (i18n-iso-countries)',
      'Saudi-ID-Validator',
      'published SSA, IRS, HMRC and Qatar ID rules',
    ],
  };
}

// A human provider name for a detected value: a fixed public prefix first,
// then the gitleaks rule name that matches the value. Null when neither knows.
export function providerLabel(value) {
  if (typeof value !== 'string' || !value) return null;
  const hit = PROVIDER_PREFIXES.find(([prefix]) => value.startsWith(prefix));
  if (hit) return hit[1];
  const rule = detectSensitiveData(value, { profile: 'secrets' }).find(
    (finding) => finding.imported && finding.ruleId,
  );
  if (!rule || rule.ruleId === 'generic-api-key') return null;
  const words = rule.ruleId.split('-').filter(Boolean);
  if (!words.length) return null;
  const label = words.join(' ');
  return label[0].toUpperCase() + label.slice(1);
}
