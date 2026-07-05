#!/usr/bin/env bash
# PreToolUse hook (Bash) — block the two known-broken integration-test SCOPING
# forms that silently run the whole ~370-itest suite instead of one file, and
# point the caller at the consumer's integration-scoped Gate-commands slot.
#
# Why a hook and not prose: the broken `-- <name>` advice survived two plugin
# audits (prose decays). This is the mechanical backstop — the same class the
# host's slot-test-guard already enforces for bare test runs.
#
# Two blocked forms, BOTH anchored at command start — a command that merely
# MENTIONS the string (grep/echo/sed over docs, this hook's own fixtures) is
# never blocked, and a compound `cd x && npm run …` is deliberately missed: on
# an advice-enforcement hook a false POSITIVE is worse than a miss.
#   (a) npm-appends-after-glob: `npm run test:integration … -- <arg>` — npm
#       appends the arg AFTER package.json's inline glob, so node --test runs
#       the full glob PLUS the file.
#   (b) env-strip: `ITEST_FILES=x capbuild …` against a PRE-1365 capbuild that
#       drops caller env at the systemd boundary. Post-1365 capbuild advertises
#       --env and forwards ITEST_FILES (it is on the default allowlist), so that
#       form is now legitimate — probe `capbuild --help` for --env and ALLOW
#       when present.
#
# Fails OPEN whenever it cannot read the command, jq is missing, or capbuild is
# not on PATH. Ships plugin-wide: the command-start anchor on `npm run
# test:integration` keeps it inert in consumers without that script; rule (b)'s
# capbuild anchor is host-tooling-specific. This is advice-enforcement, not a
# security boundary — never brick an unrelated repo.

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0

# Judge only the FIRST command segment — up to the first newline or shell
# separator (&& || | ; &). This keeps the `^` anchors true to the command start:
# a ` -- ` (or the broken form) that belongs to a LATER command in a chain or a
# heredoc body is not a false positive (`npm run test:integration && git checkout
# -- .` runs the full suite, then resets — nothing to block). Quote-naive by
# design: truncating at a separator inside a quoted arg only shortens the matched
# region, which can miss but never false-positive — and a miss is the accepted
# side per "a false positive is worse than a miss" (a leading `cd x && npm run …`
# is likewise deliberately missed).
SEG="${CMD%%$'\n'*}"
SEG="${SEG%%[&|;]*}"

deny() {
  printf '%s\n' "$1" >&2
  cat >&2 <<'EOF'

Use the consumer's integration-scoped Gate-commands slot — it runs ONE suite:
  capbuild bash -c 'AUDIT_LEDGER_ENABLED=false node --import tsx --test --test-force-exit integration/<file>.itest.ts'
(scoped-slot resolution rule, gate-protocol.md; never append a filter onto the full slot — it runs the whole tier).
EOF
  exit 2
}

# Rule (a): npm run test:integration with a trailing `-- ` filter.
if printf '%s' "$SEG" | grep -Eq '^([A-Za-z_][A-Za-z0-9_]*=[^ ]* +)*npm +run +test:integration\b.* -- '; then
  deny "Blocked: 'npm run test:integration -- <name>' does NOT scope — npm appends the arg after package.json's inline glob, so node --test runs the FULL suite PLUS your file."
fi

# Rule (b): ITEST_FILES=… capbuild … — only the PRE-1365 env-stripping capbuild
# is a problem. Post-1365 capbuild forwards ITEST_FILES, so the direct form is
# legitimate; capbuild absent → can't judge → fail-open.
if printf '%s' "$SEG" | grep -Eq '^([A-Za-z_][A-Za-z0-9_]*=[^ ]* +)*ITEST_FILES=[^ ]* +([A-Za-z_][A-Za-z0-9_]*=[^ ]* +)*capbuild\b'; then
  command -v capbuild >/dev/null 2>&1 || exit 0
  capbuild --help 2>/dev/null | grep -q -- --env && exit 0
  deny "Blocked: 'ITEST_FILES=… capbuild …' — this capbuild has no --env passthrough (pre-1365), so ITEST_FILES is stripped at the systemd boundary and the FULL suite runs."
fi

exit 0
