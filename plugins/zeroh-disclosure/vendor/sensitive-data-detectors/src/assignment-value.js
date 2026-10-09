// Values follow the supplied grammar. Unknown/prose input has only line-local
// syntax and one grammatical-opener lookback; scalar punctuation carries no
// state to another line. All endpoints are indexed once, in linear time.
const CLOSER = { ')': '(', ']': '[', '}': '{' };
const PRESENTATION = /^[ \t]*(?:(?:>|[-*+]|\d+\.)[ \t]+)+/u;
const ASSIGNMENT =
  /^(?:(?:export|set|setx)[ \t]+|\$env:)?["']?[A-Za-z_][\w.-]*["']?[ \t]*(?::=|[:=])[ \t]*/iu;
const OPENER =
  /(?:^|[=:\s])(?:(?:await|new)[ \t]+)?(?:[A-Za-z_$][\w$.]*[ \t]*)?\([ \t]*$|(?:^|[=:][ \t]*)[[{][ \t]*$/u;

export class AssignmentIndex {
  constructor(text, context, shellQuotes) {
    this.text = text;
    this.context = context;
    this.shellQuotes = shellQuotes;
    this.lines = [];
    this.lineAt = new Uint32Array(text.length + 1);
    this.scopeAt = new Uint32Array(text.length + 1);
    this.pair = new Int32Array(text.length + 1).fill(-1);
    this.quoteEnd = new Int32Array(text.length + 1).fill(-1);
    this.codeComment = new Uint8Array(text.length + 1);
    this.regexEnd = new Int32Array(text.length + 1).fill(-1);
    this.quotedAt = new Uint8Array(text.length + 1);
    this.enclosingQuoteEnd = new Int32Array(text.length + 1).fill(-1);
    this.embeddedAssignment = new Uint8Array(text.length + 1);
    this.argumentEnd = new Uint32Array(text.length + 1);
    this.semicolonBefore = new Int32Array(text.length + 1).fill(-1);
    this.semicolonAfter = new Int32Array(text.length + 1).fill(-1);
    this.wordEnd = new Uint32Array(text.length + 1);
    this.shellEnd = new Uint32Array(text.length + 1);
    const code = context?.channel === 'code' || context?.language === 'json';
    const scopes = [{ end: text.length }];
    let stack = [0];
    let quote = '';
    let quoteStart = 0;
    let quoteWidth = 1;
    let escaped = false;
    const javascript = ['javascript', 'typescript'].includes(context?.language);
    const templatePrev = javascript
      ? new Int32Array(text.length + 1).fill(-1)
      : null;
    const templateTails = new Map();
    const templates = [];
    let previousWord = '';
    const regexKeywords = new Set([
      'return',
      'throw',
      'yield',
      'case',
      'void',
      'typeof',
      'delete',
    ]);
    const comments = context?.channel === 'code';
    let blockComment = false;
    let previousCode = '';
    let regexClass = false;
    let previousOpener = false;
    let previousChar = '(';
    for (let start = 0; start < text.length;) {
      const newline = text.indexOf('\n', start);
      const end = newline < 0 ? text.length : newline;
      const raw = text.slice(start, end);
      const prefix =
        PRESENTATION.exec(raw)?.[0].length ?? raw.match(/^[ \t]*/u)[0].length;
      const stripped = raw.slice(prefix);
      const assignment =
        /^(?:set|setx)[ \t]/iu.test(stripped) && context?.channel !== 'shell'
          ? null
          : ASSIGNMENT.exec(stripped);
      const line = {
        start,
        end,
        prefix: start + prefix,
        configuration: Boolean(assignment),
        rhs: assignment ? start + prefix + assignment[0].length : -1,
        lookback: previousOpener,
        comment: raw.search(
          context?.language === 'ini' ? /[ \t][;#]/u : /[ \t]#/u,
        ),
        skip:
          /^(?:```|~~~)/u.test(stripped) ||
          (context?.language === 'ini' &&
            /^\[[^\]]*\][ \t]*(?:[;#].*)?$/u.test(stripped)) ||
          ((!context ||
            context.channel === 'prose' ||
            context.language === 'ini') &&
            /^\[[A-Za-z_][\w .:-]*\][ \t]*$/u.test(stripped)),
      };
      previousOpener = OPENER.test(stripped);
      const openerChar = stripped.trimEnd().at(-1);
      if (!code) {
        if (!(context?.language === 'toml' && stack.length > 1))
          stack = line.lookback
            ? [0, scopes.push({ char: previousChar, end }) - 1]
            : [0];
        if (!(context?.language === 'toml' && quoteWidth === 3 && quote)) {
          quote = '';
          escaped = false;
        }
      }
      previousChar = openerChar;
      let lineComment = false;
      let commentQuote = '';
      let commentStart = -1;
      let commentEscaped = false;
      let semicolon = -1;
      const lineNumber = this.lines.push(line) - 1;
      for (let i = start; i <= end; i += 1) {
        this.lineAt[i] = lineNumber;
        this.semicolonBefore[i] = semicolon;
        if (text[i] === ';') semicolon = i;
        this.scopeAt[i] = stack.at(-1);
        this.quotedAt[i] = quote ? 1 : 0;
        if (javascript && quote === '`') {
          templatePrev[i] = templateTails.get(quoteStart) ?? -1;
          templateTails.set(quoteStart, i);
        }
        const ch = text[i];
        if (
          comments &&
          !quote &&
          !blockComment &&
          !lineComment &&
          ((ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) ||
            (context.language === 'python' && ch === '#'))
        ) {
          blockComment = ch === '/' && text[i + 1] === '*';
          lineComment = !blockComment;
        }
        if (comments && (blockComment || lineComment)) {
          this.codeComment[i] = 1;
          this.scopeAt[i] = 0;
          this.quotedAt[i] = commentQuote ? 1 : 0;
          if (blockComment && ch === '*' && text[i + 1] === '/') {
            this.codeComment[i + 1] = 1;
            i += 1;
            blockComment = false;
            commentQuote = '';
          } else if (commentEscaped) commentEscaped = false;
          else if (commentQuote) {
            if (ch === '\\') commentEscaped = true;
            else if (ch === commentQuote) {
              this.quoteEnd[commentStart] = i;
              this.enclosingQuoteEnd.fill(i, commentStart + 1, i);
              commentQuote = '';
            }
          } else if (ch === '"' || ch === "'" || ch === '`') {
            commentQuote = ch;
            commentStart = i;
          }
          continue;
        }
        if (
          javascript &&
          !quote &&
          ch === '/' &&
          (!previousCode ||
            regexKeywords.has(previousWord) ||
            /[=(:,!\[{}?;&|]/u.test(previousCode))
        ) {
          quote = '/';
          quoteStart = i;
          quoteWidth = 1;
          regexClass = false;
          previousCode = '/';
          continue;
        }
        if (quote === '/') {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '[') regexClass = true;
          else if (ch === ']') regexClass = false;
          else if (ch === '/' && !regexClass) {
            let last = i + 1;
            while (last < end && /[dgimsuvy]/u.test(text[last])) last += 1;
            this.regexEnd[quoteStart] = last;
            this.enclosingQuoteEnd.fill(last, quoteStart + 1, last);
            this.quotedAt.fill(1, quoteStart + 1, last);
            quote = '';
            previousCode = '/';
            previousWord = '';
            i = last - 1;
          } else if (i === end) {
            quote = '';
            escaped = false;
          }
          continue;
        }
        if (!quote && ch && !/\s/u.test(ch)) {
          previousCode = ch;
          previousWord = /[A-Za-z0-9_$]/u.test(ch)
            ? (previousWord + ch).slice(-10)
            : '';
        }
        if (escaped) {
          escaped = false;
          continue;
        }
        if (quote) {
          if (
            javascript &&
            quote === '`' &&
            !escaped &&
            ch === '$' &&
            text[i + 1] === '{'
          ) {
            templates.push({ start: quoteStart, depth: stack.length });
            quote = '';
            previousCode = '{';
            previousWord = '';
            continue;
          }
          if (ch === '\\' && (quote !== "'" || code)) escaped = true;
          else if (
            ch === quote &&
            context?.language === 'yaml' &&
            quote === "'" &&
            text[i + 1] === "'"
          ) {
            this.quotedAt[i + 1] = 1;
            i += 1;
          } else if (
            text.slice(i, i + quoteWidth) === quote.repeat(quoteWidth)
          ) {
            this.quoteEnd[quoteStart] = i;
            if (javascript && quote === '`') {
              // Only this template's literal bytes belong to its quote.
              // Interpolated expressions and nested literals own their state.
              const owned = [];
              for (
                let at = templateTails.get(quoteStart);
                at >= 0;
                at = templatePrev[at]
              )
                if (at < i) owned.push(at);
              owned.reverse();
              const literal = owned.map((at) => text[at]).join('');
              const assignment = /(?:^|[;,&?\n])[ \t]*[A-Za-z_][\w .-]*=/u.test(
                literal,
              );
              for (const at of owned) {
                this.enclosingQuoteEnd[at] = i;
                if (assignment) this.embeddedAssignment[at] = 1;
              }
              templateTails.delete(quoteStart);
            } else {
              this.enclosingQuoteEnd.fill(i, quoteStart + quoteWidth, i);
              // Connection strings and assignment lists remain configuration.
              if (
                code &&
                /(?:^|[;,&?\n])[ \t]*[A-Za-z_][\w .-]*=/u.test(
                  text.slice(quoteStart + quoteWidth, i),
                )
              )
                this.embeddedAssignment.fill(1, quoteStart + quoteWidth, i);
            }
            previousCode = quote;
            previousWord = '';
            quote = '';
            i += quoteWidth - 1;
          }
          continue;
        }
        if (ch === '"' || ch === "'" || (code && ch === '`')) {
          quote = ch;
          quoteStart = i;
          quoteWidth =
            (code || context?.language === 'toml') &&
            text.slice(i, i + 3) === ch.repeat(3)
              ? 3
              : 1;
          i += quoteWidth - 1;
        } else if (
          '([{'.includes(ch ?? '\0') &&
          (context?.language !== 'toml' || stack.length > 1 || i === line.rhs)
        ) {
          const id = scopes.push({ open: i, char: ch, end: end }) - 1;
          stack.push(id);
        } else if (CLOSER[ch] && scopes[stack.at(-1)].char === CLOSER[ch]) {
          const scope = scopes[stack.pop()];
          scope.end = i;
          if (scope.open !== undefined) this.pair[scope.open] = i;
          const template = templates.at(-1);
          if (template && stack.length === template.depth) {
            templates.pop();
            quote = '`';
            quoteStart = template.start;
            quoteWidth = 1;
          }
        }
      }
      start = end + 1;
    }
    // Next line at the same or a lower indentation: block scalar boundary.
    const indents = [];
    for (let i = this.lines.length - 1; i >= 0; i -= 1) {
      const line = this.lines[i];
      line.indent = text
        .slice(line.start, line.end)
        .match(/^[ \t]*/u)[0].length;
      if (!text.slice(line.start, line.end).trim()) continue;
      while (indents.length && this.lines[indents.at(-1)].indent > line.indent)
        indents.pop();
      line.blockEnd = indents.length
        ? this.lines[indents.at(-1)].start
        : text.length;
      indents.push(i);
    }
    // Each scope's next comma/closer is maintained while walking backwards.
    const next = scopes.map((scope) => scope.end);
    // A properties backslash continuation belongs to the same scalar.
    for (let i = this.lines.length - 1; i >= 0; i -= 1) {
      const line = this.lines[i];
      line.logicalEnd = line.end;
      let slashes = 0;
      for (
        let at = line.end - 1;
        at >= line.start && text[at] === '\\';
        at -= 1
      )
        slashes += 1;
      if (
        context?.language === 'properties' &&
        slashes % 2 &&
        this.lines[i + 1]
      )
        line.logicalEnd = this.lines[i + 1].logicalEnd;
    }
    let nextSemi = -1;
    let word = text.length;
    let shell = text.length;
    for (let i = text.length - 1; i >= 0; i -= 1) {
      const ch = text[i];
      if (ch === ';') nextSemi = i;
      this.semicolonAfter[i] = nextSemi;
      const scope = this.scopeAt[i];
      if (
        (ch === ',' || (code && /[;\n)\]}]/u.test(ch))) &&
        !this.insideQuote(i)
      )
        next[scope] = i;
      this.argumentEnd[i] = next[scope];
      if (/\s/u.test(ch) || (ch === '\\' && this.quotedAt[i])) word = i;
      this.wordEnd[i] = word;
      if (shellQuotes) {
        if (!shellQuotes[i] && /[\s;&|()<>]/u.test(ch)) shell = i;
      } else if (/\s/u.test(ch)) shell = i;
      this.shellEnd[i] = shell;
    }
  }

  insideQuote(at) {
    return this.shellQuotes?.[at] || this.quotedAt?.[at];
  }

  value(at, keyAt, connection = false) {
    const text = this.text;
    const line = this.lines[this.lineAt[at]];
    const context = this.context;
    const language = context?.language;
    if (line.skip) return null;
    if (
      context?.channel === 'code' &&
      ((text[at - 1] === '=' && /[=>]/u.test(text[at])) ||
        this.regexEnd[at] >= at)
    )
      return null;
    // A label inside a language string is not a key expression. Quoted
    // object keys end before the value slot and remain eligible.
    if (
      context?.channel === 'code' &&
      this.quotedAt[keyAt] &&
      !this.codeComment[keyAt] &&
      this.enclosingQuoteEnd[keyAt] > at &&
      (!this.embeddedAssignment[keyAt] || !text.slice(keyAt, at).includes('='))
    )
      return null;
    const argument =
      !this.codeComment[keyAt] &&
      (context?.channel === 'code' ||
        language === 'json' ||
        ((!context ||
          context.channel === 'prose' ||
          language === 'yaml' ||
          language === 'compose' ||
          language === 'toml') &&
          (((!context || context.channel === 'prose') && line.lookback) ||
            ((keyAt >= line.rhs || !line.configuration) &&
              this.scopeAt[keyAt] > 0))));
    // A typed declaration assigns its value after the type annotation.
    if (context?.channel === 'code' && text.slice(keyAt, at).includes(':')) {
      const annotation =
        /^[A-Za-z_]\w*(?:<[\w <>,|[\]]+>)?(?:\[\])?[ \t]*=[ \t]*/u.exec(
          text.slice(at, this.argumentEnd[at]),
        );
      if (annotation) at += annotation[0].length;
    }
    let end = argument ? this.argumentEnd[at] : this.wordEnd[at];
    let start = at;
    let quoted = false;
    let quote = 0;
    const literalPrefix =
      context?.channel === 'code'
        ? (/^[rubf]{1,2}(?=["'])/iu.exec(text.slice(at, at + 3))?.[0].length ??
          0)
        : 0;
    const quoteAt = at + literalPrefix;
    const close = this.quoteEnd[quoteAt];
    // A single delimiter in a comment's inline-code example has no scalar
    // value. Real assignments inside the example remain eligible.
    if (
      this.codeComment[keyAt] &&
      text[quoteAt] === '`' &&
      close === quoteAt + 2 &&
      /[()[\]{}]/u.test(text[quoteAt + 1])
    )
      return null;
    if (
      (language === 'yaml' || language === 'compose') &&
      /^[|>](?:[1-9][+-]?|[+-][1-9]?|)[ \t]*(?:#.*)?$/u.test(
        text.slice(at, line.end),
      )
    ) {
      const first = this.lines[this.lineAt[at] + 1];
      if (!first || first.start >= line.blockEnd) return null;
      start = first.start + first.indent;
      end = line.blockEnd;
      while (end > start && /[\r\n]/u.test(text[end - 1])) end -= 1;
      quoted = true;
    } else if (language !== 'properties' && close >= at) {
      quoted = true;
      quote = text[quoteAt] === "'" ? 1 : 2;
      const width =
        (context?.channel === 'code' || language === 'toml') &&
        text.slice(quoteAt, quoteAt + 3) === text[quoteAt].repeat(3)
          ? 3
          : 1;
      start = quoteAt + width;
      end = close;
      if (context?.channel === 'shell' && close + 1 < this.shellEnd[at]) {
        // Adjacent quoted/unquoted pieces form one shell word.
        start = at;
        end = this.shellEnd[at];
      }
    } else if (context?.channel === 'shell') end = this.shellEnd[at];
    else if (
      context?.channel === 'config' &&
      language !== 'json' &&
      !argument
    ) {
      end = language === 'properties' ? line.logicalEnd : line.end;
      // Comment delimiters are format grammar, not scalar punctuation.
      if (
        language !== 'properties' &&
        line.comment >= 0 &&
        line.start + line.comment >= at
      )
        end = line.start + line.comment;
      while (end > at && /[ \t\r]/u.test(text[end - 1])) end -= 1;
    }
    if (argument && !quoted) {
      while (end > at && /\s/u.test(text[end - 1])) end -= 1;
    }
    const pair = this.pair[at];
    const collection =
      pair >= at &&
      (language === 'json' ||
        language === 'toml' ||
        context?.channel === 'code' ||
        ((language === 'yaml' ||
          language === 'compose' ||
          !context ||
          context.channel === 'prose') &&
          pair <= line.end &&
          /:[ \t]|,[ \t]/u.test(text.slice(at, pair))));
    if (!quoted && collection && /[[{]/u.test(text[at])) return null;
    // A connection embedded in a larger string retains its semicolon boundary.
    if (
      (connection ||
        this.embeddedAssignment[keyAt] ||
        /password|pwd/iu.test(text.slice(keyAt, at))) &&
      this.semicolonBefore[keyAt] >= line.start
    ) {
      const semi = this.semicolonAfter[at];
      if (semi >= 0 && semi < end) end = semi;
    }
    if (!quoted && this.enclosingQuoteEnd[at] >= 0)
      end = Math.min(end, this.enclosingQuoteEnd[at]);
    // A scalar embedded in a language literal is literal too; code-word
    // exemptions cannot turn an alphabetic connection password into a label.
    if (this.quotedAt[keyAt] && this.embeddedAssignment[keyAt]) quoted = true;
    return {
      start,
      end,
      quoted,
      quote,
      argument,
      configuration: line.configuration && !argument,
      // A later key can sit inside an already accepted long scalar. Let the
      // engine compare its indexed span before slicing/validating that suffix.
      get value() {
        return text.slice(start, end);
      },
    };
  }
}
