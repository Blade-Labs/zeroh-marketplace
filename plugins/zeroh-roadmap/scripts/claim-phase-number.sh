#!/usr/bin/env bash
# claim-phase-number.sh — atomically reserve the next free phase number.
#
# Concurrent Claude sessions computing "max + 1" independently collide; this
# script makes CREATION the lock: it computes the next candidate across
# roadmap/phases/ AND roadmap/archive/, then creates
# roadmap/phases/.claims/<N>.claim with noclobber (set -C). A concurrent loser
# gets EEXIST and retries at N+1. Prints the claimed number on stdout.
#
# Lifecycle: the claim file is deleted by the commit that lands
# roadmap/phases/phase-<N>.phase.ts (plan-phase Step 6). Add
# `roadmap/phases/.claims/` to the consumer's .gitignore — claims are
# machine-local coordination, never committed.
#
# Usage: scripts/claim-phase-number.sh [<roadmap-root>]   (default: ./roadmap)
set -euo pipefail

ROADMAP_ROOT="${1:-roadmap}"
PHASES_DIR="$ROADMAP_ROOT/phases"
CLAIMS_DIR="$PHASES_DIR/.claims"

[ -d "$PHASES_DIR" ] || { echo "claim-phase-number: no such dir: $PHASES_DIR" >&2; exit 1; }
mkdir -p "$CLAIMS_DIR"

max_declared() {
  {
    # Declared numbers in active + archived phase files (declared value, not filename)
    grep -rhoE '(^|[{,])[[:space:]]*phase:[[:space:]]*[0-9]+[[:space:]]*,' \
      "$PHASES_DIR" "$ROADMAP_ROOT/archive" 2>/dev/null \
      | grep -oE '[0-9]+' || true
    # Outstanding claims count too — an uncommitted reservation is still taken
    ls "$CLAIMS_DIR" 2>/dev/null | grep -oE '^[0-9]+' || true
  } | sort -n | tail -1
}

N=$(( $(max_declared | grep -E '^[0-9]+$' || echo 0) + 1 ))

# Creation IS the lock: noclobber write fails with EEXIST if a concurrent
# session claimed the same number first — retry at N+1.
while true; do
  if ( set -C; : > "$CLAIMS_DIR/$N.claim" ) 2>/dev/null; then
    echo "$N"
    exit 0
  fi
  N=$(( N + 1 ))
  if [ "$N" -gt 1000000 ]; then
    echo "claim-phase-number: runaway retry loop — inspect $CLAIMS_DIR" >&2
    exit 1
  fi
done
