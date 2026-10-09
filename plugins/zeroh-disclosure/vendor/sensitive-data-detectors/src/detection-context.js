// A channel alone cannot establish interpolation. Unknown and mixed inputs
// deliberately receive the conservative, legacy detector behavior.
export function detectionContext(channel, context) {
  const detail = typeof context === 'string' ? { language: context } : context;
  if (
    !detail ||
    detail.mixed ||
    detail.language === 'mixed' ||
    detail.interpolation === 'mixed' ||
    (detail.shell && detail.language && detail.shell !== detail.language)
  )
    return null;
  const language = detail.shell ?? detail.language;
  const supported = {
    shell: ['bash', 'powershell', 'cmd'],
    config: [
      'json',
      'yaml',
      'dotenv',
      'env',
      'toml',
      'ini',
      'compose',
      'properties',
    ],
    code: ['javascript', 'typescript', 'python', 'go', 'java', 'rust'],
    prose: ['prose', 'markdown', 'text'],
  };
  if (!supported[channel]?.includes(language)) return null;
  return { channel, language, interpolation: detail.interpolation };
}

// Quote state is indexed once, not by rescanning a long line per finding.
// Shell single quotes protect dollar text in Bash and PowerShell. cmd expands
// percent variables inside quotes too. Backslash/backtick escapes protect dollars.
export function quoteIndex(text, context) {
  if (!context || context.channel !== 'shell') return null;
  const out = new Uint8Array(text.length);
  let quote = 0;
  let escaped = false;
  const escape = context.language === 'powershell' ? '`' : '\\';
  for (let i = 0; i < text.length; i += 1) {
    out[i] = quote;
    if (escaped) {
      out[i] = 3;
      escaped = false;
    } else if (text[i] === escape && quote !== 1) escaped = true;
    else if (text[i] === "'" && quote !== 2) quote = quote === 1 ? 0 : 1;
    else if (text[i] === '"' && quote !== 1) quote = quote === 2 ? 0 : 2;
  }
  return out;
}

const BASH_REFERENCE = /^\$(?:[A-Za-z_]\w*|[0-9]|\{(?:[A-Za-z_]\w*|[0-9])\})$/u;
const POWERSHELL_REFERENCE =
  /^\$(?:env:[A-Za-z_]\w*|[A-Za-z_]\w*|\{env:[A-Za-z_]\w*\})$/iu;
const CMD_REFERENCE = /^%(?:[A-Za-z_]\w*%|[0-9])$/u;
const HELM_REFERENCE = /^\{\{\s*\.Values(?:\.[A-Za-z_]\w*)+\s*\}\}$/u;
const JINJA_REFERENCE =
  /^\{\{[ \t]*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*[ \t]*\}\}$/u;
const CAT_REFERENCE = /^\$\(cat[ \t]+(?:[~./A-Za-z_][A-Za-z0-9_./~-]*)\)$/u;
const POWERSHELL_SUBEXPRESSION =
  /^\$\([ \t]*\$(?:env:)?[A-Za-z_]\w*[ \t]*\)$/iu;
const ACTIONS_REFERENCE =
  /^\$\{\{\s*(?:env|github|secrets|vars|needs|steps)(?:\.[A-Za-z_]\w*)+\s*\}\}$/u;

export function pureReference(value, context, quote = 0) {
  if (!context) return false;
  if (
    context.interpolation === 'github-actions' &&
    ACTIONS_REFERENCE.test(value)
  )
    return true;
  if (context.interpolation === 'jinja' && JINJA_REFERENCE.test(value))
    return true;
  if (context.interpolation === 'helm' && HELM_REFERENCE.test(value))
    return true;
  if (context.channel === 'shell') {
    if (context.language === 'cmd') return CMD_REFERENCE.test(value);
    if (quote === 1 || quote === 3) return false;
    if (context.language === 'bash')
      return BASH_REFERENCE.test(value) || CAT_REFERENCE.test(value);
    return (
      POWERSHELL_REFERENCE.test(value) || POWERSHELL_SUBEXPRESSION.test(value)
    );
  }
  if (context.channel === 'config') {
    // JSON, TOML, INI and ordinary YAML do not interpolate on their own.
    if (
      context.interpolation === 'compose' ||
      context.interpolation === 'dotenv'
    )
      return quote !== 1 && BASH_REFERENCE.test(value);
  }
  return false;
}

// The user/password separator is outside expansions, not the colon inside
// ${NAME:-fallback}, $(...), $env:NAME, or a template expression.
export function credentialPair(value) {
  let braces = 0;
  let parens = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '{' && (braces || value[i - 1] === '$')) braces += 1;
    else if (value[i] === '}') braces = Math.max(0, braces - 1);
    else if (value[i] === '(' && (parens || value[i - 1] === '$')) parens += 1;
    else if (value[i] === ')') parens = Math.max(0, parens - 1);
    else if (value[i] === ':' && !braces && !parens) {
      if (value.slice(0, i).toLowerCase() === '$env') continue;
      return {
        user: value.slice(0, i),
        password: value.slice(i + 1),
        separator: i,
      };
    }
  }
  // Unbalanced expansion-like text is ambiguous, not permission to discard
  // an otherwise detected credential. Preserve it using the first separator.
  const separator = value.indexOf(':');
  return separator < 0
    ? null
    : {
        user: value.slice(0, separator),
        password: value.slice(separator + 1),
        separator,
      };
}

// Mixed quotes in a credential argument have independent interpolation states.
// Strip only syntactic boundary quotes, never quotes literal inside another quote.
export function credentialParts(value, start, quotes) {
  const pair = credentialPair(value);
  if (!pair) return null;
  const part = (raw, at) => {
    let from = 0;
    let to = raw.length;
    const syntax = (char, position) =>
      quotes &&
      (char === "'" ? quotes[position] !== 2 : quotes[position] !== 1);
    if (/^["']/u.test(raw) && syntax(raw[0], at)) from += 1;
    if (to > from && /["']$/u.test(raw) && syntax(raw[to - 1], at + to - 1))
      to -= 1;
    return { value: raw.slice(from, to), quote: quotes?.[at + from] ?? 0 };
  };
  return {
    user: part(pair.user, start),
    password: part(pair.password, start + pair.separator + 1),
  };
}
