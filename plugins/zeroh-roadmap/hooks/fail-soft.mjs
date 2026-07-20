#!/usr/bin/env node
/**
 * fail-soft — the hook entrypoint wrapper. A hook that crashes while LOADING (a moved import, a
 * half-installed plugin, a syntax error in a dependency) dumps a raw Node stack onto the user's
 * prompt and can wedge the turn; an in-body try/catch cannot catch that, because the body never
 * runs. So every mjs hook is launched THROUGH here: the real hook is dynamic-import()ed inside a
 * try/catch, and its own crash becomes ONE named line + exit 0.
 *
 * What this deliberately does NOT soften: a hook's successful VERDICT. A guard that evaluates and
 * decides to block still writes its decision and exits its own code — fail-soft covers the hook's
 * own failure, never its judgment (softening a verdict would turn a safety control off silently,
 * the exact inversion of the rule).
 *
 * Usage: node hooks/fail-soft.mjs <hook-file.mjs>  (stdin/stdout/argv pass through untouched).
 */
const target = process.argv[2]

if (!target) {
  process.stderr.write('[zeroh-roadmap] fail-soft: no hook module given — nothing to run\n')
  process.exit(0)
}

const name = target.split('/').pop()

try {
  const mod = await import(target)
  // A hook module either self-runs on import (today's shape) or exports a default it wants called.
  if (typeof mod.default === 'function') {
    const code = await mod.default(process.argv.slice(3))
    process.exit(typeof code === 'number' ? code : 0)
  }
} catch (err) {
  process.stderr.write(`[zeroh-roadmap] hook ${name} failed soft: ${err?.message ?? String(err)}\n`)
  process.exit(0)
}
