#!/usr/bin/env bash
# fake-slot — the ONE controllable gate-slot command the fixture consumer binds every
# gateCommands slot to (arc ROADCODE 1660, pre-made decision 2). It lets a wired suite
# force a red/green gate deterministically AND prove verbatim {files}/{range} substitution:
#
#   $1                = the slot name (lint | types | unit | integration | build | emit |
#                       unit-scoped | integration-scoped | unit-impacted | integration-impacted)
#   exit code         = FIXTURE_SLOT_<NAME>_EXIT  (name uppercased, '-' → '_'; default 0)
#   side effect       = append {slot, argv, ts} as ONE JSONL line to $FIXTURE_SLOT_LOG
#                       (argv is the FULL arg vector incl. the slot name, so a suite asserts
#                        the substituted file/range list from the RECORD, never CLI narration)
#
# Pure bash — a fake slot must not need a toolchain. No `set -e`: the point is to exit with
# the requested (possibly non-zero) code, not to abort early.
set -u

slot="${1:-}"
name="$(printf '%s' "$slot" | tr 'a-z-' 'A-Z_')"
var="FIXTURE_SLOT_${name}_EXIT"
code="${!var:-0}"

if [ -n "${FIXTURE_SLOT_LOG:-}" ]; then
  argv_json='['
  first=1
  for a in "$@"; do
    # JSON-escape backslash then double-quote (the only two structural chars a slot arg
    # can carry that would break the JSONL line).
    esc="$(printf '%s' "$a" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    if [ "$first" -eq 1 ]; then first=0; else argv_json="${argv_json},"; fi
    argv_json="${argv_json}\"${esc}\""
  done
  argv_json="${argv_json}]"
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"slot":"%s","argv":%s,"ts":"%s"}\n' "$slot" "$argv_json" "$ts" >> "$FIXTURE_SLOT_LOG"
fi

exit "$code"
