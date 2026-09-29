// SPDX-License-Identifier: AGPL-3.0-only

// Claude Code's own Bash "too-complex" check, transcribed for tests: a
// restored command must pass it, or Claude Code refuses it (Windows re-test,
// finding 5). Used by test/claude-code-shell-check.test.mjs,
// test/windows-retest.test.mjs and test/windows-real.test.mjs.
// Claude Code's Bash check, copied from the compiled `claude` executable of
// Claude Code 2.1.283 (~/.local/share/claude/versions/2.1.283, module that
// starts `var he=1e4,He=new Set(["export","declare",...`), function iAe:
//
//   if(rt.test(Re(e)))return{kind:"too-complex",
//     reason:"Contains brace with quote character (expansion obfuscation)",
//     differential:!0};
//
// with rt=/\{[^}]*['"]/ and Re below, kept as close to the minified source as
// the linter allows (names spelled out, logic unchanged). The same check is
// in 2.1.281 and 2.1.282. A "too-complex" command matches no allow rule, so a
// headless run refuses it with that reason (the Windows rc.2 report, try step
// 6) and an interactive run asks.
const rt = /\{[^}]*['"]/;
function Re(e) {
  if (!e.includes('{')) return e;
  let n = [],
    s = !1,
    t = !1,
    a = !1,
    r = !0,
    f = 0;
  while (f < e.length) {
    let c = e[f];
    if (a)
      if (
        c === '\\' &&
        (e[f + 1] === '`' || e[f + 1] === '\\' || e[f + 1] === '$')
      )
        (n.push(c, e[f + 1]), (f += 2));
      else {
        if (c === '`') a = !1;
        (n.push(c === '{' ? ' ' : c), f++);
      }
    else if (s) {
      if (c === "'") s = !1;
      (n.push(c === '{' ? ' ' : c), f++);
    } else if (t)
      if (
        c === '\\' &&
        (e[f + 1] === '"' || e[f + 1] === '\\' || e[f + 1] === '`')
      )
        (n.push(c, e[f + 1]), (f += 2));
      else if (c === '`') ((a = !0), n.push(c), f++);
      else {
        if (c === '"') t = !1;
        (n.push(c === '{' ? ' ' : c), f++);
      }
    else if (c === '\\' && f + 1 < e.length) {
      if ((n.push(c, e[f + 1]), e[f + 1] !== '\n')) r = !1;
      f += 2;
    } else if (c === '#' && r) {
      while (f < e.length && e[f] !== '\n') (n.push(e[f]), f++);
      r = !0;
    } else if (c === '`') ((a = !0), (r = !1), n.push(c), f++);
    else {
      if (c === "'") s = !0;
      else if (c === '"') t = !0;
      ((r =
        c === ' ' ||
        c === '\t' ||
        c === '\n' ||
        c === ';' ||
        c === '|' ||
        c === '&' ||
        c === '(' ||
        c === ')' ||
        c === '<' ||
        c === '>'),
        n.push(c),
        f++);
    }
  }
  return n.join('');
}
export const claudeCodeRefuses = (command) => rt.test(Re(command));
export { Re, rt };
