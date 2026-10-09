// Compatibility policy from 4355efbfe. Unknown text keeps the legacy
// endpoints and exemptions; the shared engine handles scanning and overlaps.
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
function quotedNotSecret(value, name = '') {
  const v = value.trim();
  if (!v) return true;
  if (/^<%=[^>]*%>$/u.test(v)) return true;
  if (PLACEHOLDER.test(v) || TYPE_WORDS.has(v.toLowerCase())) return true;
  if (
    /^(?:%[sdr]|%\(\w+\)[sdr]|\{[A-Za-z_][\w.]*\}|(?:process\.env|import\.meta\.env|os\.environ)(?:\.[A-Za-z_]\w*|\[["'][^"']+["']\]))$/u.test(
      v,
    )
  )
    return true;
  const bare = (text) => text.toLowerCase().replace(/[^a-z0-9]/gu, '');
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

// looksLikeCodeValue for a value slot (after a secret-named key or
// `Password=`): it reads a value starting with `$NAME`, `${` or `%` as code,
// but in a value slot a value starting with a reference is a reference or a
// literal with a reference in it (`${PGPASS:-hunter2x}`, `$X-hunter2x`,
// `%X%hunter2x`), and a value either way.
function codeInValueSlot(value, name, options) {
  if (/^(?:\$(?:\{|[A-Za-z_])|%[A-Za-z_]\w*%)/u.test(value)) return false;
  return looksLikeCodeValue(value, name, options);
}

// A key that is a quoted branch of a conditional (`cond ? 'secret' : 'x'`),
// not an assignment.
function ternaryBranch(match) {
  const keyAt = match.index + match[0].indexOf(match[1]);
  return /\?\s*["']$/u.test(match.input.slice(Math.max(0, keyAt - 8), keyAt));
}

// Names that contain a secret word but never hold one.
const NON_SECRET_NAME =
  /(?:_URL|_URI|_PATH|_FILE|_DIR|_PREFIX|_SUFFIX|_TIMEOUT(?:_MS|_SECONDS)?|_TTL|_SCOPE|_HEADER|_NAME|_ID|_REGION|_ENDPOINT|MAX_\w*TOKENS?|_TOKENS|PUBLIC_?KEY|_ICON_KEY|_KEY_ID|TOKEN_TYPE|_LENGTH|_SIZE|_COUNT|_ENABLED|_MODE)$/i;

// Values that are placeholders or already tokens. Not references: `$X`,
// `${X}`, `${X-literal}` and `$X-literal` are values (see quotedNotSecret).
const PLACEHOLDER =
  /^(?:<%=[^>]*%>|<(?:(?:your|example|placeholder)[-_][A-Za-z_]+|string|password|token|secret|pw)>|\[[A-Z_]+-[0-9a-f]{6}\]|x{3,}|\*{3,}|changeme|your[-_].*|example|placeholder|todo|null|none|true|false|undefined|redacted|\.\.\.)$/i;

// `group` value meaning "the first capture group that matched" (gitleaks).
const FIRST_NON_EMPTY = 'first';

function unquote(value) {
  return /^(["'`]).+\1$/su.test(value) ? value.slice(1, -1) : value;
}

export function legacyRules(catalog, overlayById, knownRules, gaps, nameType) {
  const SECRET_RULES = [
    ...knownRules.filter((rule) => !rule.assignment && !rule.overPersonalData),
    ...gaps
      .filter((rule) => rule.id === 'github-app-token-stateless')
      .map((rule) => ({ ...rule, id: undefined })),
    {
      type: 'PASSWORD',
      risk: 'critical',
      pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@'"]+:([^\s@/'"]{3,})@/gi,
      group: 1,
      confidence: 0.95,
      overPersonalData: true,
      // Not the documentation stand-ins (`user:pass@host`, `user:<pw>@host`).
      // A reference (`user:${PW}@host`, `user:${X-pw}@host`) is a value.
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
      // A reference (`Pwd=%DB_PASS%;`, `Password=${X:-pw};`) is a value.
      // A plain word is a value here, in a sentence too (`password=<word>`):
      // masking it in place is restorable, while a missed password leaks.
      validate: (v) => {
        const core = v.includes('(') ? v : v.replace(/[,):]+$/u, '');
        return (
          !PLACEHOLDER.test(core) &&
          !/^(?:password|passwd|pwd|pass)$/iu.test(core) &&
          !codeInValueSlot(core, 'password', { words: false })
        );
      },
    },
    {
      // KEY=value, key: value, or a quoted JSON key with a secret-shaped name,
      // including a bare `password: …` or `token = …`. Key, separator and value sit
      // on one line. A random-looking value is the most certain case and is
      // masked like any other (DET-1). A complete quoted literal runs to its
      // closing quote (escapes included) and is the secret unless it is a
      // placeholder, a format expression or a label (quotedNotSecret). An unquoted value stops at
      // a backslash, so an escaped newline in a string (`KEY=value\nNEXT=…`)
      // does not join lines.
      type: 'SECRET',
      risk: 'critical',
      pattern: new RegExp(
        `(?:^|[\\s{,;(])["']?([A-Za-z_][A-Za-z0-9_.-]*${SECRET_NAME}[A-Za-z0-9_]*|${BARE_SECRET_NAME})["']?[ \\t]*[:=][ \\t]*(?:"((?:[^"\\\\\\r\\n]|\\\\[^\\r\\n]){6,})"|'((?:[^'\\\\\\r\\n]|\\\\[^\\r\\n]){6,})'|["']?([^\\s"',;}{)\\\\]{6,}))`,
        'gim',
      ),
      group: FIRST_NON_EMPTY,
      groups: [2, 3, 4],
      confidence: 0.9,
      validate: (value, match) =>
        !NON_SECRET_NAME.test(match[1]) &&
        !/^\d{1,7}$/.test(value) &&
        !/^https?:\/\/[^@]*$/.test(value) &&
        (match[4] === undefined
          ? !quotedNotSecret(value, match[1]) && !ternaryBranch(match)
          : !PLACEHOLDER.test(value) && !codeInValueSlot(value, match[1])),
      typeOf: (match) => nameType(match[1]),
      genericShape: true,
      retryInside: true,
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

  const GITLEAKS_RULES = catalog.rules.map((rule) => {
    const overlay = overlayById.get(rule.id);
    const pattern = new RegExp(rule.regex, rule.flags);
    return {
      ...rule,
      risk: 'critical',
      confidence: 0.84,
      pattern,
      group: rule.secretGroup ?? FIRST_NON_EMPTY,
      groups: unnamedGroups(pattern.source),
      imported: true,
      secretInside: overlay?.secretInside,
      legacyCredential: overlay?.credentialPair,
      ...(overlay?.genericShape
        ? {
            genericShape: true,
            validate: (value) =>
              !PLACEHOLDER.test(unquote(value)) &&
              !looksLikeCodeValue(unquote(value)),
          }
        : {}),
      allowlists: (rule.allowlists ?? []).map((allowlist) => ({
        ...allowlist,
        // Lower-cased once here; allowlistHit compares a lower-cased target.
        stopwords: (allowlist.stopwords ?? []).map((word) =>
          String(word).toLowerCase(),
        ),
        regexes: (allowlist.regexes ?? []).map(
          (regex) => new RegExp(regex.regex, regex.flags),
        ),
      })),
    };
  });

  // The one extension to legacy curl capture is literal punctuation. All
  // other unknown curl forms retain upstream endpoints and allowlists.
  const literalCurl = overlayById.get('curl-auth-user');
  const curl = GITLEAKS_RULES.find((rule) => rule.id === 'curl-auth-user');
  return [
    ...SECRET_RULES,
    ...GITLEAKS_RULES,
    {
      ...curl,
      pattern: new RegExp(literalCurl.regex, curl.flags),
      group: literalCurl.secretGroup,
      allowlists: [],
      legacyCredential: false,
      credentialPair: true,
      literalCredential: true,
    },
  ];
}

// Only expansion-prefixed braces/parentheses are structural. A single quote
// inside double quotes is credential data, not shell boundary syntax.
export function literalCredentialPunctuation(value, start, quotes) {
  let braces = 0;
  let parens = 0;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '{') {
      if (!braces && value[i - 1] !== '$') return true;
      braces += 1;
    } else if (char === '}') braces = Math.max(0, braces - 1);
    else if (char === '(') {
      if (!parens && value[i - 1] !== '$') return true;
      parens += 1;
    } else if (char === ')') parens = Math.max(0, parens - 1);
    else if (char === "'" && quotes[start + i] === 2) return true;
  }
  return false;
}
