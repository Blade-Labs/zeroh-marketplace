// SPDX-License-Identifier: AGPL-3.0-only

// Whether a secret finding in a shell command is only a variable reference
// that the shell expands (1.0.0 detector-exceptions redesign).
//
// The detector does not judge references: whether `$KEY` is expanded
// depends on which interpreter reads the text, so it masks `$KEY` like any
// value (restorable). Only here, where a Bash or PowerShell command is about
// to run, is the interpreter known. A finding whose whole value, as the
// shell parses the command (lib/shell-scan.js, oracle-tested against real
// Bash), is plain parameter expansions joined only by `:` is not a raw
// secret the model wrote: it names where a value lives.
//   references   Bash `$NAME`, `${NAME}`, `$1`; PowerShell `$NAME`,
//                `$env:NAME`, `${NAME}`, `${env:NAME}` and a subexpression
//                holding only one of them (`$($env:NAME)`, the usual way to
//                end a name before `:`, which evaluates to exactly its
//                value); unquoted or in double quotes: `-u "$KEY:"`,
//                `-u "$USER:$PASS"`, `-u "$($env:KEY):"`.
//   not          anything with a literal character: single-quoted text,
//                `%X%` or `{{x}}` in Bash, a default (`${X:-lit}`,
//                `${X-lit}`), any other command substitution (`$(cat f)`,
//                `$(echo x)`, Bash `$($X)`), backticks, a heredoc body, a
//                word the parser cannot read.
// What such a reference sends is whatever the variable holds, which ZeroH
// cannot see: pre-tool-use treats it as an uncertain destination (a notice
// in `pass` mode, a stop in `block` mode), not as a raw-secret stop.
import { analyzeShell } from './shell-scan.js';

// Characters that may join references inside one finding.
const SEPARATORS = new Set([':']);

function wordsOf(commands) {
  const words = [];
  for (const command of commands) {
    words.push(...(command.words ?? []), ...(command.assignments ?? []));
    for (const redirect of command.redirects ?? [])
      if (redirect.target) words.push(redirect.target);
  }
  return words;
}

// The source parts of every word of `command` read by `shell`, or null
// when the command cannot be parsed. Words from a backtick body or a
// PowerShell group are parsed from another string: only words whose source
// range holds their own text are kept.
//
// Code handed to another shell (`eval …`, `bash -c …`, `pwsh -Command …`,
// `iex …`, `cmd /c …`, `env -S …`) is read a second time by that shell, so
// an outer reference there is not the value verbatim: its parts count as an
// expansion. A code word that is one literal run of the source (a
// single-quoted `bash -c` script) is read with the inner shell instead, at
// the same offsets, so a reference the inner shell expands is still proven.
export function commandParts(command, shell = 'bash', depth = 0) {
  const source = String(command ?? '');
  const parsed = analyzeShell(source, shell);
  if (!parsed.ok) return null;
  const replaced = new Map();
  for (const entry of parsed.commands) {
    if (entry.inline) continue;
    for (const script of entry.scripts ?? []) {
      if (script.language === 'foreign' || script.language === 'argv') continue;
      for (const word of script.words ?? []) {
        const inner =
          script.words.length === 1 && !script.foreignSyntax && depth < 4
            ? literalCodeParts(source, word, script.language, depth)
            : null;
        replaced.set(
          word,
          inner ??
            word.parts.map((part) =>
              part.kind === 'reference' ? { ...part, kind: 'expansion' } : part,
            ),
        );
      }
    }
  }
  const parts = [];
  for (const word of wordsOf(parsed.commands.filter((c) => !c.inline))) {
    if (!word.parts?.length || source.slice(word.start, word.end) !== word.raw)
      continue;
    parts.push(...(replaced.get(word) ?? word.parts));
  }
  return parts;
}

// The parts of a code word whose value is one literal run of the source
// (single quotes, or plain text), read by the inner shell and moved to the
// outer offsets; null when the word is anything else.
function literalCodeParts(source, word, language, depth) {
  const literal = word.parts.filter((part) => part.kind === 'literal');
  if (
    literal.length !== 1 ||
    word.parts.some((part) => part.kind !== 'literal' && part.kind !== 'syntax')
  )
    return null;
  const [run] = literal;
  if (source.slice(run.start, run.end) !== word.value) return null;
  const inner = commandParts(word.value, language, depth + 1);
  if (!inner) return null;
  return [
    ...word.parts.filter((part) => part.kind === 'syntax'),
    ...inner.map((part) => ({
      ...part,
      start: part.start + run.start,
      end: part.end + run.start,
    })),
  ];
}

// True when every character of source[start, end) is part of a plain
// reference, a quote, or a `:` written between them, and at least one is a
// reference.
export function referenceOnly(command, start, end, shell = 'bash', parts) {
  const source = String(command ?? '');
  const all = parts === undefined ? commandParts(source, shell) : parts;
  if (!all || !(end > start)) return false;
  let reference = false;
  for (let i = start; i < end; i += 1) {
    const part = all.find((entry) => entry.start <= i && i < entry.end);
    if (!part) return false;
    if (part.kind === 'reference') reference = true;
    else if (part.kind === 'syntax') continue;
    else if (part.kind !== 'literal' || !SEPARATORS.has(source[i]))
      return false;
  }
  return reference;
}

// The replacements (lib/tool-policies.js perField) of a shell command's
// findings that are only references, as a Set of `field index:start`.
export function referenceFindings(perField, shell) {
  const out = new Set();
  if (shell !== 'bash' && shell !== 'powershell') return out;
  perField.forEach((field, index) => {
    if (field.urlField || field.path?.join('.') !== 'command') return;
    const parts = commandParts(field.original, shell);
    if (!parts) return;
    for (const entry of field.replacements ?? [])
      if (referenceOnly(field.original, entry.start, entry.end, shell, parts))
        out.add(`${index}:${entry.start}`);
  });
  return out;
}

// A restored value that is only variable references, written so each
// reference keeps its boundary wherever it lands: Bash `${NAME}`, `${1}`;
// PowerShell `${NAME}`, `${env:NAME}`, `$($env:NAME)` as typed. `:` stays.
// Null for anything else.
const BRACED = {
  bash: /\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$\{[0-9]+\}|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9]|:/uy,
  powershell:
    /\$\([ \t]*\$(?:env:)?[A-Za-z_][A-Za-z0-9_]*[ \t]*\)|\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}|\$(?:env:)?[A-Za-z_][A-Za-z0-9_]*|:/iuy,
};
export function bracedReference(value, shell) {
  const re = BRACED[shell];
  const text = String(value ?? '');
  if (!re || !text || !referenceOnly(text, 0, text.length, shell)) return null;
  let out = '';
  re.lastIndex = 0;
  while (re.lastIndex < text.length) {
    const m = re.exec(text);
    if (!m) return null;
    const piece = m[0];
    out +=
      piece === ':' || piece.startsWith('${') || piece.startsWith('$(')
        ? piece
        : `\${${piece.slice(1)}}`;
  }
  return out;
}

// Restored reference values written inline, occurrence by occurrence: an
// occurrence of a token is replaced by its braced reference only where
// `${…}` at that exact place would be a plain expansion the shell performs
// (the tokenizer's reading: not single-quoted, `$'…'`, escaped, a quoted
// here-doc, after `--%`, or code for another shell). `references` maps a
// token to its braced reference. { command, inlined: Set of tokens whose
// every occurrence was inlined }.
export function inlineReferences(command, shell, references) {
  const source = String(command ?? '');
  const probe = '${ZHREF}';
  const hits = [];
  const seen = new Map();
  for (const [token, text] of references) {
    let count = 0;
    for (
      let i = source.indexOf(token);
      i >= 0;
      i = source.indexOf(token, i + 1)
    ) {
      count += 1;
      const probed =
        source.slice(0, i) + probe + source.slice(i + token.length);
      if (referenceOnly(probed, i, i + probe.length, shell))
        hits.push({ start: i, end: i + token.length, text, token });
    }
    seen.set(token, count);
  }
  hits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const hit of hits)
    out = out.slice(0, hit.start) + hit.text + out.slice(hit.end);
  const inlined = new Set(
    [...seen]
      .filter(
        ([token, count]) =>
          count > 0 && hits.filter((h) => h.token === token).length === count,
      )
      .map(([token]) => token),
  );
  return { command: out, inlined };
}
