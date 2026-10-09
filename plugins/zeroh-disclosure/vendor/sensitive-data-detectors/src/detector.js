// The detection engine. Three profiles:
//   prompt  — secrets and personal data; for text a person writes.
//   tool    — the same, without national-format phone numbers; for tool
//             output, where digit groups are usually code, sizes or times.
//   secrets — secrets only.
// Personal data is detected by vendored libraries (./pii). No rule detects
// names or currency amounts.
// A rule with `group` masks only that capture group (the value after a key
// name, the password inside a URL), so the surrounding text stays readable.

import { isDocumentationPlaceholder } from './documentation-placeholder.js';
import {
  findPersonalData,
  LIBPHONENUMBER_VERSION,
  PERSONAL_DATA_KINDS,
  phoneRegion,
  PII_RULES,
  TLD_VERSION,
  VALIDATOR_VERSION,
} from './pii/index.js';
import { maskedTokenSpans, isGatewayToken } from './masked-tokens.js';
import { lowerBound, TextIndex } from './text-index.js';
import { legacyRules, literalCredentialPunctuation } from './legacy-values.js';
import { AssignmentIndex } from './assignment-value.js';
import {
  credentialParts,
  detectionContext,
  pureReference,
  quoteIndex,
} from './detection-context.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// The provider rules imported from gitleaks (src/rules/gitleaks.generated.json),
// read-only.
export const GITLEAKS_CATALOG = deepFreeze(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL('./rules/gitleaks.generated.json', import.meta.url),
      ),
      'utf8',
    ),
  ),
);

const GITLEAKS_OVERLAY = deepFreeze(
  JSON.parse(
    readFileSync(
      new URL('./rules/GITLEAKS_OVERLAY.json', import.meta.url),
      'utf8',
    ),
  ),
);
const OVERLAY_BY_ID = new Map(
  GITLEAKS_OVERLAY.rules.map((rule) => [rule.id, rule]),
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

// A call/index/generic expression must occupy the entire scalar. Balanced
// groups may be followed only by another access or call, not literal text.
function completeAccessExpression(value) {
  let prefix = 0;
  while (value[prefix] === '(') prefix += 1;
  let wrappers = prefix;
  const head = /^(?:(?:await|new)[ \t]+)?[A-Za-z_$][\w$]*/u.exec(
    value.slice(prefix),
  );
  if (!head) return false;
  let at = prefix + head[0].length;
  let grouped = wrappers > 0;
  const closer = { ')': '(', ']': '[', '}': '{', '>': '<' };
  while (at < value.length) {
    if (/[ \t]/u.test(value[at])) {
      at += 1;
      continue;
    }
    if (value[at] === ')' && wrappers > 0) {
      wrappers -= 1;
      at += 1;
      continue;
    }
    const member = /^(?:\?\.|\.)[A-Za-z_$][\w$]*/u.exec(value.slice(at));
    if (member) {
      at += member[0].length;
      continue;
    }
    if (value.startsWith('?.', at) && '(['.includes(value[at + 2])) at += 2;
    if (!'([<'.includes(value[at])) return false;
    grouped = true;
    const stack = [value[at++]];
    let quote = '';
    let escaped = false;
    let regexClass = false;
    let previous = '(';
    while (at < value.length && stack.length) {
      const ch = value[at++];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quote) {
        if (ch === '\\') escaped = true;
        else if (quote === '/' && ch === '[') regexClass = true;
        else if (quote === '/' && ch === ']') regexClass = false;
        else if (ch === quote && !regexClass) quote = '';
      } else if (ch === '"' || ch === "'" || ch === '\x60') quote = ch;
      else if (ch === '/' && /[=(:,!\[{}?;&|]/u.test(previous)) {
        quote = '/';
        regexClass = false;
      } else if ('([{'.includes(ch) || (ch === '<' && stack.at(-1) === '<'))
        stack.push(ch);
      else if (closer[ch] && (ch !== '>' || stack.at(-1) === '<')) {
        if (stack.pop() !== closer[ch]) return false;
      }
      if (!/\s/u.test(ch)) previous = ch;
    }
    if (stack.length || quote) return false;
  }
  return grouped && wrappers === 0;
}

// True when the text after a secret-named key is code or a name, not a value.
// Every exemption tests the original scalar whole. Code-shaped values
// commonly use these forms:
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
//   - a call, index access or generic (`getpass()`, `headers[Name]`,
//     `Array<string>`);
//   - a package version or range (`^9.0.2`, `~1.40`, `>=3.2`).
// `words: false` keeps plain words (a letters-only value) as possible values,
// for rules whose key is unambiguous (a connection string's `Password=`).
export function looksLikeCodeValue(value, name = '', { words = true } = {}) {
  const v = String(value);
  if (
    /^(?:(?:[/~]|\.\.?\/)[^\s]+|[!&*][A-Za-z_][\w.-]*(?:[ \t]+[A-Za-z_][\w.-]*)?|<(?:string|number|boolean|T|K|V)>|%[sdr]|\d+\*[A-Za-z_][\w.-]*)$/u.test(
      v,
    )
  )
    return true;
  if (/^\[[A-Za-z_][A-Za-z_., \t]*\]$/u.test(v)) return true;
  if (v.startsWith('(') && v.endsWith(')')) {
    const inner = v.slice(1, -1);
    if (
      /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*$/u.test(inner) ||
      completeAccessExpression(inner)
    )
      return true;
  }
  const core = v;
  if (!core) return true;
  if (TYPE_WORDS.has(core.toLowerCase())) return true;
  if (
    /^(?:[\^~]|[<>]=?|=)?v?\d+(?:\.(?:\d+|[xX*]))+(?:[-+][\w.-]+)?$/u.test(core)
  )
    return true;
  if (completeAccessExpression(core)) return true;
  if (
    /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+!?(?:[ \t]+as[ \t]+[A-Za-z_]\w*(?:\[\])?)?$/u.test(
      core,
    )
  )
    return true;
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

// A complete quoted literal after a secret-named key is the secret, whatever
// it holds: leading spaces or braces, all-word passphrases, operator-like
// words. Only these quoted values are not:
//   - a format verb or a code expression whose value is elsewhere: `%s`,
//     `%(name)s`, `{name}`, `process.env.X`, `os.environ["X"]`. A shell,
//     env-file or template reference (`$VAR`, `${VAR}`, `${VAR:-x}`,
//     `$env:VAR`, `%VAR%`, `{{ … }}`, `${{ … }}`, `<%= … %>`) is a value
//     here: whether it is expanded depends on which interpreter reads the
//     text, which the detector cannot know. Masking a reference is
//     restorable; a literal read as a reference leaks. ZeroH Disclosure
//     judges references only when it decides whether a command stops;
//   - the documented placeholders (PLACEHOLDER) and OpenAPI's example type
//     names (`"password": "string"`);
//   - a name, not a value: the key's own name (`PASSWORD: 'password'`), an
//     environment variable name (`password: 'POSTGRES_ADMIN_PASSWORD'`), or an
//     identifier that itself names a secret (`SessionToken:
//     "x-ms-session-token"`, `"msal:acquireTokenSuccess"`), or an
//     `x-…` header name;
//   - a package version (`"jsonwebtoken": "^9.0.2"`) or a complete CSS value
//     (`'token': 'var(--brand-500)'`, `hsl(…)`, `1px solid calc(…)`): every
//     component a CSS function call, number, colour, custom property or CSS
//     keyword, split only where CSS splits (completeCssValue). A literal with
//     a CSS call inside (`"Tr0ub4dor!calc(42)"`, `"x-calc(42)-987"`,
//     `"correct horse calc(42) staple"`) is still a secret;
//   - a UI label about the secret itself, by construction (labelConstruction):
//     an instruction (`"Enter your password"`, `"Forgot your password?"`), a
//     sentence about it (`"Password must be at least 8 characters."`), or a
//     short name (`"New password"`, `"Access token"`). A passphrase is still a
//     secret, with a secret word or a common word in it or not (`"correct horse
//     secret staple"`, `"correct horse secret and staple"`).
const SECRET_LABEL_WORD =
  /^(?:passwords?|passphrases?|passwd|pins?|tokens?|secrets?|keys?|credentials?|api|otp|codes?)$/iu;
// UI labels about a secret, by construction (Astra rc.2 V3): not any phrase
// that happens to hold a secret word and a common word. `words` are lower
// case, without trailing punctuation; the secret word is the head noun.
const LABEL_VERBS = new Set(
  'enter type confirm re-enter retype repeat show hide reset change update generate copy forgot choose create set paste regenerate revoke rotate'.split(
    ' ',
  ),
);
const LABEL_DETERMINERS = new Set(
  'a an the your my this that new current old invalid incorrect wrong expired missing required temporary one-time personal access api secret'.split(
    ' ',
  ),
);
const LABEL_VERBS_AFTER = new Set(
  "must should is are was were does do cannot can can't needs need has have will may expires expired required invalid incorrect missing changed updated copied".split(
    ' ',
  ),
);
const LABEL_TAIL = new Set(
  'again here below now to continue for this account'.split(' '),
);
function labelConstruction(words, original) {
  // [verb] determiner* SECRET tail*: "Enter your password", "Show
  // password", "Forgot your password?", "Confirm new password again".
  let i = 0;
  const verb = LABEL_VERBS.has(words[0]);
  if (verb) i = 1;
  while (i < words.length && LABEL_DETERMINERS.has(words[i])) i += 1;
  const head = i;
  if (head >= words.length || !SECRET_LABEL_WORD.test(words[head]))
    return false;
  // "API key" style compounds: a second secret word is part of the head.
  let after = head + 1;
  if (after < words.length && SECRET_LABEL_WORD.test(words[after])) after += 1;
  const rest = words.slice(after);
  if (verb) return rest.every((word) => LABEL_TAIL.has(word));
  // determiner* SECRET verb …: "Password must be at least 8 characters.",
  // "Token expired", "Your API key is invalid".
  if (rest.length && LABEL_VERBS_AFTER.has(rest[0])) return true;
  // determiner+ SECRET: "New password", "Current password".
  if (!rest.length && head > 0) return true;
  // A short capitalised name of the secret: "Access token", "API key".
  return (
    !rest.length &&
    words.length <= 3 &&
    /^\p{Lu}/u.test(original[0]) &&
    !/[.,:;!?)]$/u.test(original.at(-1))
  );
}
// A complete CSS value (Astra rc.2 V3): component values separated by
// whitespace, commas or slashes, each a CSS function call that ends where
// the component ends, a number or dimension, a hex colour, a custom
// property name or a CSS keyword; at least one function. Nothing is split
// that CSS itself would not split.
const CSS_FUNCTIONS = new Set(
  'var calc min max clamp rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix env url linear-gradient radial-gradient conic-gradient repeating-linear-gradient translate translatex translatey rotate scale matrix cubic-bezier steps minmax repeat fit-content attr counter'.split(
    ' ',
  ),
);
const CSS_KEYWORDS = new Set(
  (
    'none auto inherit initial unset revert solid dashed dotted double groove ridge inset outset hidden ' +
    'transparent currentcolor bold bolder lighter normal italic oblique block inline inline-block flex ' +
    'inline-flex grid contents center left right top bottom middle start end baseline stretch ' +
    'space-between space-around space-evenly wrap nowrap row column absolute relative fixed sticky ' +
    'static visible scroll ease ease-in ease-out ease-in-out linear infinite alternate forwards ' +
    'backwards both pointer default thin medium thick small large x-small x-large smaller larger ' +
    'uppercase lowercase capitalize underline serif sans-serif monospace cursive fantasy system-ui ' +
    'to at circle ellipse closest-side farthest-corner in srgb display-p3 black white red green blue ' +
    'gray grey silver orange yellow purple pink brown navy teal cover contain no-repeat repeat-x repeat-y'
  ).split(/\s+/u),
);
const CSS_ATOM_RE =
  /^(?:[-+]?(?:\d+\.?\d*|\.\d+)(?:[a-z]{1,4}|%)?|#[0-9a-fA-F]{3,8}|--[A-Za-z0-9_-]+|[+*/-])$/u;

// The component values of `text` (split at top-level whitespace, commas and
// slashes), or null when a parenthesis is unbalanced.
function cssComponents(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const c of text) {
    if (c === '(') depth += 1;
    if (c === ')') {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (depth === 0 && /[\s,/]/u.test(c)) {
      if (current) parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  if (depth !== 0) return null;
  if (current) parts.push(current);
  return parts;
}

function cssComponent(part, depth, found) {
  if (depth > 8) return false;
  const call = /^([a-z][a-z-]*)\((.*)\)$/su.exec(part);
  if (call) {
    if (!CSS_FUNCTIONS.has(call[1])) return false;
    found.calls += 1;
    const inner = cssComponents(call[2]);
    return (
      inner !== null &&
      inner.every((piece) => cssComponent(piece, depth + 1, found))
    );
  }
  return CSS_ATOM_RE.test(part) || CSS_KEYWORDS.has(part);
}

function completeCssValue(v) {
  if (v.length > 2000 || !/\(/u.test(v)) return false;
  const parts = cssComponents(v);
  if (!parts?.length) return false;
  const found = { calls: 0 };
  return parts.every((part) => cssComponent(part, 0, found)) && found.calls > 0;
}
function quotedNotSecret(value, name = '', context) {
  const v = String(value);
  if (!v.trim()) return true;
  if (
    context?.channel === 'code' &&
    /^PRIVATE[_-]KEY$/iu.test(name) &&
    v === 'private key'
  )
    return true;
  if (/^\{[A-Za-z_][\w.]*\}$/u.test(v))
    return (
      context?.channel === 'code' && context.interpolation === 'python-format'
    );
  if (PLACEHOLDER.test(v) || TYPE_WORDS.has(v.toLowerCase())) return true;
  if (/^(?:#\{[^{}]+\}|<%=[^>]*%>)$/u.test(v)) return true;
  if (
    /^(?:%[sdr]|%\(\w+\)[sdr]|\{[A-Za-z_][\w.]*\}|(?:process\.env|import\.meta\.env|os\.environ)(?:\.[A-Za-z_]\w*|\[["'][^"']+["']\]))$/u.test(
      v,
    )
  )
    return true;
  const bare = (text) => text.toLowerCase();
  if (name && bare(v) === bare(String(name).split('.').pop())) return true;
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/u.test(v) && /[A-Z]{2}/u.test(v))
    return true;
  if (
    /^[A-Za-z][A-Za-z_.:-]*$/u.test(v) &&
    /password|passwd|passphrase|token|secret|credential|api[_-]?key/iu.test(v)
  )
    return true;
  if (/^(?:[\^~]|[<>]=?|=)?v?\d+(?:\.(?:\d+|[xX*]))+(?:[-+][\w.-]+)?$/u.test(v))
    return true;
  if (completeCssValue(v)) return true;
  if (/^x-[a-z0-9]+(?:-[a-z0-9]+)+$/iu.test(v)) return true;
  const words = v.split(/\s+/u);
  if (
    words.length < 2 ||
    !words.every((word) =>
      /^(?:\p{L}[\p{L}'’-]*|\d{1,3})[.,:;!?)]*$/u.test(word),
    )
  )
    return false;
  const bareWords = words.map((word) =>
    word.replace(/[.,:;!?)]+$/u, '').toLowerCase(),
  );
  return labelConstruction(bareWords, words);
}

function completeReferenceCombination(value) {
  const parts = value.split(/\?\?|\|\||&&/u);
  return (
    parts.length > 1 &&
    parts.every(
      (part) =>
        /^(?:[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*|\{\}|\[\])$/u.test(
          part.trim(),
        ) || completeAccessExpression(part.trim()),
    )
  );
}

// Exemptions read the original scalar whole, including its final punctuation.
function codeInValueSlot(value, name, options) {
  if (/^\$\([A-Za-z_]\w*\)$/u.test(value)) return true;
  if (/^(?:\$|%[A-Za-z_]\w*%|\{\{)/u.test(value)) return false;
  if (
    !/password|passwd|passphrase|(?:^|[_.-])pwd$/iu.test(name) &&
    /^[A-Za-z_.-]+(?:[,;=][A-Za-z_.-]+)*$/u.test(value)
  )
    return true;
  if (
    options.code &&
    (completeArrowExpression(value) ||
      /^[A-Za-z_]\w*(?:\[\])?(?:[ \t]*[|&][ \t]*[A-Za-z_]\w*(?:\[\])?)+$/u.test(
        value,
      ) ||
      completeReferenceCombination(value))
  )
    return true;
  return looksLikeCodeValue(value, name, options);
}

function completeArrowExpression(value) {
  const arrow = /^\([\w$.,:<>? |[\]\t={}]*\)[ \t]*=>[ \t]*(.+)$/su.exec(value);
  return Boolean(
    arrow &&
    (/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*$/u.test(arrow[1]) ||
      completeAccessExpression(arrow[1])),
  );
}

// A key that is a quoted branch of a conditional (`cond ? 'secret' : 'x'`),
// not an assignment.
function ternaryBranch(match) {
  const keyAt = match.index + match[0].indexOf(match[1]);
  return /\?\s*["']$/u.test(match.input.slice(Math.max(0, keyAt - 8), keyAt));
}

// A prose directive names an empty assignment field: "Set password= to ...".
// The preposition is label grammar, rather than a supplied scalar value.
function assignmentLabel(match, context) {
  if (context && context.channel !== 'prose') return false;
  const keyAt = match.index + match[0].indexOf(match[1]);
  const before = match.input.slice(Math.max(0, keyAt - 40), keyAt);
  const verb = /\b([A-Za-z-]+)[ \t]+$/u.exec(before)?.[1].toLowerCase();
  return (
    LABEL_VERBS.has(verb) &&
    /=\s+$/u.test(match[0]) &&
    /^to[ \t]+/u.test(
      match.input.slice(
        match.index + match[0].length,
        match.index + match[0].length + 4,
      ),
    )
  );
}

// Names that contain a secret word but never hold one.
const NON_SECRET_NAME =
  /(?:_URL|_URI|_PATH|_FILE|_DIR|_PREFIX|_SUFFIX|_TIMEOUT(?:_MS|_SECONDS)?|_TTL|_SCOPE|_HEADER|_NAME|_ID|_REGION|_ENDPOINT|MAX_\w*TOKENS?|_TOKENS|PUBLIC_?KEY|_ICON_KEY|_KEY_ID|TOKEN_TYPE|_LENGTH|_SIZE|_COUNT|_ENABLED|_MODE)$/i;

// Values that are placeholders or already tokens. Not references: `$X`,
// `${X}`, `${X-literal}` and `$X-literal` are values (see quotedNotSecret).
const PLACEHOLDER =
  /^(?:<%=[^>]*%>|<(?:(?:your|example|placeholder)[-_][A-Za-z_]+|string|password|token|secret)>|\[[A-Z_]+-[0-9a-f]{6}\]|x{3,}|\*{3,}|changeme|your[-_].*|example|placeholder|todo|null|none|true|false|undefined|redacted|\.\.\.)$/i;

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
  if (rule.secretInside) {
    const m = new RegExp(rule.secretInside, 'u').exec(out);
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

// Locate a key only. AssignmentIndex supplies the complete value endpoint.
function keyNameRule(setx = false) {
  return {
    type: 'SECRET',
    risk: 'critical',
    confidence: 0.9,
    pattern: new RegExp(
      (setx
        ? String.raw`\bsetx[ \t]+`
        : String.raw`(?:^|[\s{,;(\[])(?:\$env:)?`) +
        String.raw`["']?([A-Za-z_][A-Za-z0-9_.-]*${SECRET_NAME}[A-Za-z0-9_]*|${BARE_SECRET_NAME})["']?` +
        (setx ? String.raw`[ \t]+()` : String.raw`[ \t]*(?::=|[:=])[ \t]*()`),
      'gim',
    ),
    group: 2,
    assignment: true,
    genericShape: true,
    typeOf: (match) => nameType(match[1]),
    validate: (value, match, context, slot) =>
      !assignmentLabel(match, context) &&
      !ternaryBranch(match) &&
      !NON_SECRET_NAME.test(match[1]) &&
      !/^\d{1,7}$/u.test(value) &&
      !/^https?:\/\/[^@]*$/u.test(value) &&
      (slot.quoted
        ? !quotedNotSecret(value, match[1], context)
        : !PLACEHOLDER.test(value) &&
          !TYPE_WORDS.has(value.toLowerCase()) &&
          !codeInValueSlot(value, match[1], {
            code: context?.channel === 'code',
            words:
              context?.channel !== 'config' &&
              !(
                !slot.argument &&
                context?.channel !== 'code' &&
                /password|passwd|passphrase|pwd/iu.test(match[1])
              ),
          })),
  };
}

function connectionPasswordRule() {
  return {
    type: 'PASSWORD',
    risk: 'critical',
    confidence: 0.94,
    pattern:
      /(?:^|[;&?\s,({\[])(Password|Pwd|AccountKey|SharedAccessKey)=[ \t]*()/gi,
    group: 2,
    assignment: true,
    connectionValue: true,
    validate: (v, _match, context, slot) =>
      (v.length >= 4 || slot.configuration) &&
      !PLACEHOLDER.test(v) &&
      !/^(?:password|passwd|pwd|pass)$/iu.test(v) &&
      !(slot.quoted && quotedNotSecret(v, 'password', context)) &&
      !codeInValueSlot(v, 'password', {
        code: context?.channel === 'code',
        words: Boolean(slot.argument || context?.channel === 'code'),
      }),
  };
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
    pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@'"]*:([^\s@/'"]{3,})@/gi,
    group: 1,
    confidence: 0.95,
    overPersonalData: true,
    // Not the documentation stand-ins (`user:pass@host`, `user:<pw>@host`).
    // A reference (`user:${PW}@host`, `user:${X-pw}@host`) is a value.
    validate: (v) =>
      !PLACEHOLDER.test(v) &&
      !/^(?:pass(?:word)?|passwd|pwd|secret|pw)$/iu.test(v),
  },
  connectionPasswordRule(),
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
  keyNameRule(),
  keyNameRule(true),
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
const GITLEAKS_RULES = GITLEAKS_CATALOG.rules.map((sourceRule) => {
  const rule = { ...sourceRule, ...OVERLAY_BY_ID.get(sourceRule.id) };
  const pattern = new RegExp(rule.regex, rule.flags);
  return {
    ...rule,
    risk: 'critical',
    confidence: 0.84,
    pattern,
    group: rule.secretGroup ?? FIRST_NON_EMPTY,
    groups: unnamedGroups(pattern.source),
    imported: true,
    ...(rule.genericShape
      ? {
          genericShape: true,
          validate: (value, _match, context) =>
            !PLACEHOLDER.test(unquote(value)) &&
            !looksLikeCodeValue(unquote(value), '', {
              words: context?.channel !== 'config',
            }),
        }
      : {}),
    allowlists: (rule.credentialPair ? [] : (rule.allowlists ?? [])).map(
      (allowlist) => ({
        ...allowlist,
        // Lower-cased once here; allowlistHit compares a lower-cased target.
        stopwords: (allowlist.stopwords ?? []).map((word) =>
          String(word).toLowerCase(),
        ),
        regexes: (allowlist.regexes ?? []).map(
          (regex) => new RegExp(regex.regex, regex.flags),
        ),
      }),
    ),
  };
});

const GAP_RULES = GITLEAKS_OVERLAY.gaps.map((rule) => ({
  ...rule,
  pattern: new RegExp(rule.regex, rule.flags),
  ...(rule.groups ? { group: FIRST_NON_EMPTY } : {}),
}));

// Personal data is decided by vendored libraries only (./pii: validator.js,
// libphonenumber-js). The typed prompt and tool output use the same rules;
// national-format phone numbers (which need a default region) are looked for
// only in the typed prompt.
const PROFILES = {
  prompt: [...SECRET_RULES, ...GAP_RULES, ...GITLEAKS_RULES, ...PII_RULES],
  tool: [...SECRET_RULES, ...GAP_RULES, ...GITLEAKS_RULES, ...PII_RULES],
  secrets: [...SECRET_RULES, ...GAP_RULES, ...GITLEAKS_RULES],
};
const LEGACY_RULES = legacyRules(
  GITLEAKS_CATALOG,
  OVERLAY_BY_ID,
  SECRET_RULES,
  GAP_RULES,
  nameType,
);
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

// Two kinds of value that look random but are not secrets, told apart by
// what makes them so:
//   - a public value is public by its own format, whatever names it: a
//     Stripe publishable key, an SSH public key line. No rule that locates a
//     value by a key name takes one (`STRIPE_KEY=pk_live_…`).
//   - a digest shape (a SHA-1, SHA-256 or SHA-512 hex digest, a UUID) is
//     only a shape: a commit, a content hash or a request id when nothing
//     names it, and a secret when something does. `openssl rand -hex 32`,
//     `secrets.token_hex(32)` and many providers' API keys have this shape.
//     So only a check that has nothing but the shape to go on refuses it:
//     the entropy warning below. Every rule locates its value by something
//     other than the shape (a key name, an `Authorization` header, a URL
//     password, `Password=`, a signed-URL parameter, a provider prefix) and
//     keeps it; test/digest-values.test.mjs holds both sides.
function isPublicValue(value) {
  return (
    /^pk_(?:live|test)_/i.test(value) ||
    /^ssh-(?:ed25519|rsa|ecdsa)\s/i.test(value)
  );
}

function isDigestShape(value) {
  return (
    /^(?:[a-f0-9]{40}|[a-f0-9]{64}|[a-f0-9]{128})$/i.test(value) ||
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value,
    )
  );
}

const GLOBAL_ALLOWLIST = {
  ...GITLEAKS_CATALOG.globalAllowlist,
  regexes: (GITLEAKS_CATALOG.globalAllowlist?.regexes ?? []).map(
    (entry) => new RegExp(entry.regex, entry.flags.replace('g', '')),
  ),
  stopwords: (GITLEAKS_CATALOG.globalAllowlist?.stopwords ?? []).map((word) =>
    word.toLowerCase(),
  ),
};
function globalAllowlisted(value, context, quote) {
  // Interpolation-shaped global entries require positive interpreter evidence.
  if (/^(?:\$|%|\{\{|@)/u.test(value))
    return pureReference(value, context, quote);
  return allowlistHit(GLOBAL_ALLOWLIST, value, true);
}

function allowlisted(rule, value, match, floor, index, wholeStopword = true) {
  for (const allowlist of rule.allowlists ?? []) {
    // File and commit allowlists cannot be proven by the text-only detector.
    // Failing closed avoids suppressing a finding on a different path.
    if (allowlist.paths?.length || allowlist.commits?.length) continue;
    const hit =
      allowlist.regexTarget === 'line'
        ? lineAllowlisted(allowlist, match.index, index, wholeStopword)
        : allowlistHit(
            allowlist,
            allowlist.regexTarget === 'match'
              ? withLeading(rule, match, floor)
              : value,
            wholeStopword,
          );
    if (hit) return true;
  }
  return false;
}

function allowlistHit(allowlist, target, wholeStopword = true) {
  const checks = [];
  if (allowlist.stopwords?.length) {
    const lower = target.toLowerCase();
    checks.push(
      allowlist.stopwords.some((word) =>
        wholeStopword ? lower === word : lower.includes(word),
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
  return (
    checks.length > 0 &&
    (allowlist.condition === 'AND'
      ? checks.every(Boolean)
      : checks.some(Boolean))
  );
}

// gitleaks' `regexTarget = "line"`: the allowlist reads the whole line of
// the match. Every match on one line reads the same line, so the verdict is
// kept per line (in the TextIndex of the text): a long line with many
// matches is read once per allowlist, not once per match.
function lineAllowlisted(allowlist, at, index, wholeStopword = true) {
  const newline = index.indexOf('\n', at);
  const start = index.lastIndexOf('\n', at) + 1;
  const end = newline === -1 ? index.text.length : newline;
  const verdicts = index.memo('allowlisted lines', () => new WeakMap());
  let lines = verdicts.get(allowlist);
  if (!lines) verdicts.set(allowlist, (lines = new Map()));
  const key = `${start}:${end}`;
  if (!lines.has(key))
    lines.set(
      key,
      allowlistHit(allowlist, index.text.slice(start, end), wholeStopword),
    );
  return lines.get(key);
}

// The match as gitleaks sees it: with the leading `[\w.-]{0,N}?` context the
// importer dropped for speed (see linearShape in scripts/import-gitleaks.mjs).
// The lazy context of the leftmost match reaches back over every such
// character, up to N, but not into the rule's previous match.
function withLeading(rule, match, floor) {
  let start = match.index;
  const limit = Math.max(floor, start - (rule.leading ?? 0));
  while (start > limit && /[\w.-]/u.test(match.input[start - 1])) start -= 1;
  return match.input.slice(start, match.index + match[0].length);
}

// For a rule with an `anchor` (`curl … -H`): true when `word` stands before
// `at` with at most `lineBreaks` line breaks (runs of one or two \r/\n)
// between, as upstream's `\bword\b(?:.*?|.*?(?:[\r\n]{1,2}.*?){1,N})`.
// The nearest word is the best candidate, so one check per match suffices;
// `breaks` holds the index of the last line terminator at or before each
// position, so the check never walks the line.
function anchorIndex(text, word) {
  const words = [];
  const pattern = new RegExp(`\\b${word}\\b`, 'g');
  for (const found of text.matchAll(pattern)) words.push(found.index);
  const breaks = new Int32Array(text.length);
  let last = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (/[\n\r\u2028\u2029]/u.test(text[index])) last = index;
    breaks[index] = last;
  }
  return { words, breaks, length: word.length };
}

function anchored(text, index, anchor, at) {
  const { words, breaks, length } = index;
  let lo = 0;
  let hi = words.length - 1;
  let word = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid] + length <= at) {
      word = words[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (word === -1) return false;
  const from = word + length;
  let cost = 0;
  for (let cursor = at - 1; cursor >= from;) {
    const end = breaks[cursor];
    if (end < from) return true;
    // JavaScript's `.` stops at U+2028/U+2029 too, and `[\r\n]` cannot take them.
    if (!/[\r\n]/u.test(text[end])) return false;
    let run = 0;
    while (end - run >= from && /[\r\n]/u.test(text[end - run])) {
      run += 1;
      if (run > 2 * anchor.lineBreaks) return false;
    }
    cost += Math.ceil(run / 2);
    if (cost > anchor.lineBreaks) return false;
    cursor = end - run;
  }
  return true;
}

// A URL password that displaces personal data it only partly overlaps
// masks both spans as one: in a git URL whose password is `$TOKEN`, rc.2
// read `TOKEN`, the `@` and the host as an e-mail address and masked it,
// and the URL rule now masks `$TOKEN`.
// Masking never shrinks below what rc.2 masked there: a missed character
// leaks, an extra one is restorable. Other credentials (a provider token
// before `@host`) keep their exact span.
const OVER_PERSONAL_DATA = new WeakSet();
function overPersonalData(rule, finding) {
  if (rule.overPersonalData) OVER_PERSONAL_DATA.add(finding);
  return finding;
}
function credentialOver(f, o) {
  if (!OVER_PERSONAL_DATA.has(f) || covers(f, o)) return f;
  const start = Math.min(f.start, o.start);
  const end = Math.max(f.end, o.end);
  return overPersonalData(
    { overPersonalData: true },
    { ...f, start, end, length: end - start },
  );
}

// Resolves overlaps in `fs`, sorted by start: each finding meets the first
// kept finding it overlaps. A kept finding starts at or before the current
// one (it is an earlier finding, or credentialOver's union with one), so it
// overlaps the current finding exactly when it ends after the current start. Starts only grow, so
// a kept finding that ends at or before one start overlaps no later finding
// either: `live` moves past it once, and the first kept finding from `live`
// on is the one the current finding meets. Linear in the number of findings,
// not quadratic on a log with tens of thousands of addresses.
function dedupe(fs) {
  const out = [];
  let live = 0;
  for (const f of fs) {
    while (live < out.length && out[live].end <= f.start) live += 1;
    const at = live;
    const o = out[at];
    if (!o) out.push(f);
    else if (isCredentialFinding(f) && !isCredentialFinding(o)) {
      out[at] = credentialOver(f, o);
    } else if (
      isCredentialFinding(o) &&
      !isCredentialFinding(f) &&
      !covers(o, f)
    ) {
      out[at] = credentialOver(o, f);
    } else if (
      (isCredentialFinding(f) &&
        isCredentialFinding(o) &&
        covers(f, o) &&
        !covers(o, f)) ||
      (isCredentialFinding(f) === isCredentialFinding(o) &&
        !(isCredentialFinding(f) && covers(o, f)) &&
        score(f) > score(o))
    ) {
      out[at] = f;
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

// Both scans are sorted. Merge every overlapping span, including chains of
// overlaps, so a higher-scoring or shorter contextual finding cannot shrink
// the protection supplied by the unknown-context scan.
export function unionFindings(unknown, contextual) {
  const out = [];
  let a = 0;
  let b = 0;
  while (a < unknown.length || b < contextual.length) {
    const f =
      b === contextual.length ||
      (a < unknown.length && unknown[a].start <= contextual[b].start)
        ? unknown[a++]
        : contextual[b++];
    const previous = out.at(-1);
    if (!previous || previous.end <= f.start) {
      out.push(f);
      continue;
    }
    const preferred =
      !!previous.generic !== !!f.generic
        ? previous.generic
          ? f
          : previous
        : isCredentialFinding(previous) !== isCredentialFinding(f)
          ? isCredentialFinding(f)
            ? f
            : previous
          : score(f) > score(previous)
            ? f
            : previous;
    const start = previous.start;
    const end = Math.max(previous.end, f.end);
    // Retain every specific class for downstream category filters and grants.
    // The number of types is bounded by the catalogue, including long chains.
    const protectionTypes = [
      ...new Set(
        [previous, f].flatMap(
          (finding) =>
            finding.protectionTypes ?? (finding.generic ? [] : [finding.type]),
        ),
      ),
    ];
    out[out.length - 1] = {
      ...preferred,
      start,
      end,
      length: end - start,
      ...(protectionTypes.length ? { protectionTypes } : {}),
    };
  }
  return out;
}

// Findings in `text`, sorted by position, overlaps resolved.
//   profile       'prompt' (default), 'tool' or 'secrets';
//   region        default region for national-format phone numbers (prompt
//                 profile only): a two-letter region, null for none, or
//                 undefined for the locale's (phoneRegion());
//   enabledTypes  only these types, or null for all;
//   ignore        [start, end) placeholder spans: contained findings are
//                 ignored, overlaps clipped; a function (text) => spans too.
export function detectSensitiveData(
  text,
  {
    enabledTypes = null,
    profile = 'prompt',
    region,
    ignore = null,
    channel,
    context,
  } = {},
) {
  if (typeof text !== 'string' || text.length === 0) return [];
  let knownContext = detectionContext(channel, context);
  if (
    knownContext?.channel === 'shell' &&
    /<<|--%|\b(?:eval|bash|sh|pwsh|powershell|cmd)\s+(?:-c|-Command|\/c)\b/iu.test(
      text,
    )
  )
    knownContext = null;
  const lowerText = text.toLowerCase();
  const index = new TextIndex(text);
  const tokenBounds = ignoredSpanIndex(
    [...maskedTokenSpans(text), ...ignoreSpans(ignore, text)],
    text,
  );
  const national = NATIONAL_PHONE_PROFILES.has(profile)
    ? region === undefined
      ? phoneRegion()
      : region
    : null;
  const shared = {
    enabledTypes,
    profile,
    lowerText,
    index,
    tokenBounds,
    national,
  };
  // Untrusted gateway-shaped labels need their own boundary. The separating
  // underscore can otherwise hide a valid card, IBAN or email from its normal
  // candidate parser. Never scan the digest of a recognized type placeholder.
  const labelFindings = [];
  for (const match of text.matchAll(
    /<([^<>\r\n]+?)_(?:[0-9a-f]{64}|[0-9a-f]{32}|[0-9a-f]{16})>/gu,
  )) {
    if (isGatewayToken(match[0])) continue;
    const offset = match.index + 1;
    for (const finding of detectSensitiveData(match[1], {
      enabledTypes,
      profile,
      region,
      channel,
      context,
    })) {
      labelFindings.push(
        ...tokenBounds.clip({
          ...finding,
          start: offset + finding.start,
          end: offset + finding.end,
        }),
      );
    }
  }
  const unknown = unionFindings(
    detectInContext(text, null, shared),
    labelFindings,
  );
  if (!knownContext) return unknown;
  return unionFindings(unknown, detectInContext(text, knownContext, shared));
}

// Recovery may scan thousands of tiny independent fragments. Rule objects
// are fixed; compile their indexed patterns once, then reset lastIndex for
// each scan below. Findings, indexes and context remain local to the call.
const compiledPatterns = new WeakMap();
function indexedPattern(rule) {
  let pattern = compiledPatterns.get(rule);
  if (!pattern) {
    pattern = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes('d')
        ? rule.pattern.flags
        : rule.pattern.flags + 'd',
    );
    compiledPatterns.set(rule, pattern);
  }
  return pattern;
}

function detectInContext(
  text,
  knownContext,
  { enabledTypes, profile, lowerText, index, tokenBounds, national },
) {
  const quotes = quoteIndex(text, knownContext);
  const rules = knownContext
    ? (PROFILES[profile] ?? PROFILES.prompt)
    : [...LEGACY_RULES, ...(profile === 'secrets' ? [] : PII_RULES)];
  const findings = [];
  for (const rule of rules) {
    if (rule.find) {
      if (enabledTypes && !enabledTypes.includes(rule.type)) continue;
      // Personal-data rules do not consume grammar context. Reuse their hits
      // and the text/ignore indexes across both scans of this one call.
      const hits = index.memo(rule, () =>
        findPersonalData(rule, text, { phoneRegion: national, profile, index }),
      );
      for (const hit of hits) {
        if (tokenBounds.contains(hit.start, hit.end)) continue;
        findings.push(
          ...tokenBounds.clip({
            type: rule.type,
            risk: rule.risk,
            start: hit.start,
            end: hit.end,
            length: hit.end - hit.start,
            confidence: hit.confidence,
            source: rule.source,
          }),
        );
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
    const pattern = indexedPattern(rule);
    const anchors = rule.anchor ? anchorIndex(text, rule.anchor.word) : null;
    let acceptedAssignment;
    // One match of the rule, or null when a check refuses it.
    const consider = (match, previous) => {
      if (anchors && !anchored(text, anchors, rule.anchor, match.index))
        return null;
      const g = secretGroupIndex(rule, match);
      let value = match[g];
      let start = match.indices[g][0];
      let end = match.indices[g][1];
      let slot;
      if (rule.assignment) {
        const assignments = index.memo(
          'assignments',
          () => new AssignmentIndex(text, knownContext, quotes),
        );
        slot = assignments.value(
          start,
          match.indices[1][0],
          rule.connectionValue,
        );
        if (!slot) return null;
        // This same rule already accepted a covering scalar with at least
        // the same score. Re-reading each nested suffix would be quadratic;
        // dedupe would keep the covering finding in every case.
        if (acceptedAssignment && covers(acceptedAssignment, slot)) return null;
        ({ value, start, end } = slot);
      }
      if (!value) return null;
      if (
        knownContext &&
        rule.imported &&
        rule.genericShape &&
        /,[\x60"'\s=]*$/u.test(text.slice(match.index, start))
      )
        return null;
      if (rule.imported) {
        const inner = secretInside(rule, value);
        start += inner.offset;
        value = inner.value;
        end = start + value.length;
        if (!value) return null;
      }
      if (
        rule.literalCredential &&
        !literalCredentialPunctuation(
          value,
          start,
          index.memo('legacy credential quotes', () =>
            quoteIndex(text, { channel: 'shell', language: 'bash' }),
          ),
        )
      )
        return null;
      if (rule.credentialPair || rule.legacyCredential) {
        const parts = credentialParts(
          value,
          start,
          quotes ??
            index.memo('legacy credential quotes', () =>
              quoteIndex(text, { channel: 'shell', language: 'bash' }),
            ),
        );
        // Ruling 9 retains the base exemption only for wholly unquoted
        // credentials. Quoted pairs keep HEAD's masking and denial behavior.
        if (
          parts &&
          !parts.user.quote &&
          !parts.password.quote &&
          isDocumentationPlaceholder(parts.password.value)
        )
          return null;
        // Credential separators are syntax. A wholly masked password, or a
        // masked username with an empty password, contributes no new value
        // in either detector scan. A real password must still be detected.
        if (
          parts &&
          ((parts.password.value &&
            maskedTokenSpans(parts.password.value).some(
              ([from, to]) => from === 0 && to === parts.password.value.length,
            )) ||
            (!parts.password.value &&
              maskedTokenSpans(parts.user.value).some(
                ([from, to]) => from === 0 && to === parts.user.value.length,
              )))
        )
          return null;
      }
      if (rule.legacyCredential) {
        const parts = credentialParts(value, start, null);
        if (
          parts &&
          GLOBAL_ALLOWLIST.stopwords.includes(
            parts.password.value.toLowerCase(),
          )
        )
          return null;
      }
      // Both the contextual and legacy URL rules capture the password after
      // this exact prefix. No assignment or generic-value exemption is added.
      if (
        rule.type === 'PASSWORD' &&
        /^[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@'"]*:$/iu.test(
          text.slice(match.index, start),
        ) &&
        isDocumentationPlaceholder(value)
      )
        return null;
      if (rule.validate && !rule.validate(value, match, knownContext, slot))
        return null;
      if (
        rule.assignment &&
        GLOBAL_ALLOWLIST.stopwords.includes(value.toLowerCase())
      )
        return null;
      // A public value is refused wherever a key name locates the value; a
      // provider rule matches its own format. A digest shape is kept: the
      // rule located it (see isPublicValue and isDigestShape).
      if ((!rule.imported || rule.genericShape) && isPublicValue(value))
        return null;
      if (rule.credentialPair) {
        const parts = credentialParts(value, start, quotes);
        const pair = parts && {
          user: parts.user.value,
          password: parts.password.value,
        };
        if ((pair && !pair.user && !pair.password) || isGatewayToken(value))
          return null;
        if (pair) {
          const userReference = pureReference(
            pair.user,
            knownContext,
            parts.user.quote,
          );
          const passwordReference = pureReference(
            pair.password,
            knownContext,
            parts.password.quote,
          );
          if (
            (!pair.user || userReference) &&
            (!pair.password || passwordReference)
          )
            return null;
          if (pair.password && passwordReference) return null;
          if (
            /^(?:change(?:it|me)|pass(?:word)?|pwd|test|token|\*+|x+|y+)$/iu.test(
              pair.password,
            )
          )
            return null;
          if (isGatewayToken(pair.password)) return null;
          // Upstream v8.30.1 config/allowlist.go ContainsStopWord uses substring
          // matching. The owner requires the safer text-only policy: a global
          // example exempts only a complete password, never an embedded substring.
          if (
            GLOBAL_ALLOWLIST.stopwords.some(
              (word) => pair.password.toLowerCase() === word,
            )
          )
            return null;
        }
      } else if (
        pureReference(
          value,
          knownContext,
          slot?.quote ?? quotes?.[start] ?? (text[start - 1] === "'" ? 1 : 0),
        )
      )
        return null;
      if (rule.entropy !== undefined && shannonEntropy(value) < rule.entropy)
        return null;
      if (
        allowlisted(rule, value, match, previous, index, Boolean(knownContext))
      )
        return null;
      if (
        knownContext &&
        rule.imported &&
        !rule.credentialPair &&
        globalAllowlisted(value, knownContext, quotes?.[start])
      )
        return null;
      if (tokenBounds.contains(start, end)) return null;
      const type = rule.typeOf ? rule.typeOf(match) : rule.type;
      if (enabledTypes && !enabledTypes.includes(type)) return null;
      return overPersonalData(rule, {
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
    };
    // A rule with `retryInside` looks again one character after a refused
    // match, as if it had not matched there: a refused quoted value
    // (`KEY="${OTHER_KEY:-value}"`) may hold a key and value of its own.
    let floor = 0;
    pattern.lastIndex = 0;
    for (let match; (match = pattern.exec(text));) {
      if (match[0] === '') pattern.lastIndex += 1;
      const previous = floor;
      floor = match.index + match[0].length;
      const finding = consider(match, previous);
      if (finding) {
        findings.push(
          ...tokenBounds
            .clip(finding)
            .map((part) => overPersonalData(rule, part)),
        );
        if (rule.assignment) acceptedAssignment = finding;
      } else if (rule.retryInside && floor > match.index + 1) {
        pattern.lastIndex = match.index + 1;
        floor = previous;
      }
    }
  }
  return dedupe(findings.sort((a, b) => a.start - b.start || b.end - a.end));
}

function ignoreSpans(ignore, text) {
  if (!ignore) return [];
  return typeof ignore === 'function' ? ignore(text) : ignore;
}

// Merge ignored spans once. Binary search keeps long masked output cheap;
// partial overlap retains every outside fragment, with its original metadata.
function ignoredSpanIndex(spans, text) {
  const merged = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1])
      previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  const ends = merged.map((span) => span[1]);
  return {
    contains(start, end) {
      const span = merged[lowerBound(ends, start + 1)];
      return Boolean(span && span[0] <= start && span[1] >= end);
    },
    clip(finding) {
      const parts = [];
      let cursor = finding.start;
      let index = lowerBound(ends, cursor + 1);
      if (index >= merged.length || merged[index][0] >= finding.end)
        return [finding];
      const add = (start, end) => {
        if (end > start && /[\p{L}\p{N}]/u.test(text.slice(start, end)))
          parts.push({ ...finding, start, end, length: end - start });
      };
      while (index < merged.length && merged[index][0] < finding.end) {
        const [start, end] = merged[index++];
        add(cursor, start);
        cursor = Math.max(cursor, end);
      }
      add(cursor, finding.end);
      return parts;
    },
  };
}

// A random-looking value that no rule masked and that has no key-like name
// in front of it (the key-name rules above already mask named values).
// It is sent as is; the typed-prompt hook only warns.
// A run of base64/base64url characters; a URL path segment or a bare
// command argument counts as well.
const RANDOM_VALUE =
  /(?<![A-Za-z0-9+_=-])[A-Za-z0-9+_-]{24,}={0,2}(?![A-Za-z0-9+_=-])/g;
const KEY_BEFORE = /[A-Za-z_][A-Za-z0-9_.-]*["']?[ \t]*[:=][ \t]*["']?$/u;

// `ignore` and `region` are passed to detectSensitiveData.
export function detectEntropyWarnings(text, { ignore = null, region } = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const findings = detectSensitiveData(text, {
    profile: 'prompt',
    ignore,
    region,
  });
  const ignored = ignoredSpanIndex(
    [...maskedTokenSpans(text), ...ignoreSpans(ignore, text)],
    text,
  );
  const warnings = [];
  // Values come in text order and findings are sorted by start: `seen`
  // findings start before the current value's end, and `reach` is the
  // largest end among them, so the overlap test is one comparison.
  let seen = 0;
  let reach = -1;
  for (const match of text.matchAll(RANDOM_VALUE)) {
    const value = match[0];
    const start = match.index;
    const end = start + value.length;
    if (ignored.contains(start, end)) continue;
    if (!/[A-Za-z]/u.test(value) || !/\d/u.test(value)) continue;
    if (isDigestShape(value) || isPublicValue(value) || !isEntropyGuess(value))
      continue;
    const before = text.slice(Math.max(0, start - 64), start);
    if (KEY_BEFORE.test(before)) continue;
    // The body of an SSH public key (`ssh-ed25519 AAAA… comment`).
    if (/(?:ssh-[a-z0-9]+|ecdsa-sha2-[a-z0-9]+)@?[\w.]*\s+$/u.test(before))
      continue;
    while (seen < findings.length && findings[seen].start < end)
      reach = Math.max(reach, findings[seen++].end);
    if (reach > start) continue;
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
    id: 'sensitive-data-detectors',
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

// What the engine detects, from the live rule set: provider key formats
// grouped by provider (the gitleaks rules, by the first word of their id),
// the public prefixes with a provider name, and the personal-data kinds.
// Consumers print this, so answers about coverage never drift from the code.
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
      'secrets next to key-like names (API_KEY=..., "password": ..., token: ...)',
      'private keys (PEM, OpenSSH, PuTTY, age)',
      'GitHub App installation tokens in the 2026 stateless format (ghs_<app id>_<JWT>)',
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
// `ignore` is passed to detectSensitiveData.
export function providerLabel(value, { ignore = null } = {}) {
  if (typeof value !== 'string' || !value) return null;
  const hit = PROVIDER_PREFIXES.find(([prefix]) => value.startsWith(prefix));
  if (hit) return hit[1];
  const rule = detectSensitiveData(value, { profile: 'secrets', ignore }).find(
    (finding) => finding.imported && finding.ruleId,
  );
  if (!rule || rule.ruleId === 'generic-api-key') return null;
  const words = rule.ruleId.split('-').filter(Boolean);
  if (!words.length) return null;
  const label = words.join(' ');
  return label[0].toUpperCase() + label.slice(1);
}
