#!/usr/bin/env bash
# claim-phase-number.sh — atomically reserve the next free phase number.
#
# Concurrent Claude sessions computing "max + 1" independently collide; this
# script makes CREATION the lock: it computes the next candidate across
# roadmap/phases/ AND roadmap/archive/, then creates <claims-dir>/<N>.claim with
# noclobber (set -C). A concurrent loser gets EEXIST and retries at N+1. Prints
# the claimed number on stdout.
#
# Claims live in the git COMMON dir (<git-common-dir>/zeroh-roadmap-claims) so they
# are SHARED across every worktree of the repo. The old roadmap/phases/.claims is
# gitignored and therefore PER-WORKTREE — two sessions claiming in different
# worktrees could both win the same number. The common dir is inside .git, so
# claims are never tracked (no .gitignore needed); the legacy dir is still SCANNED
# read-only during the transition so an in-flight legacy claim is still honored.
#
# Lifecycle: the claim file is removed with a plain `rm` once
# roadmap/phases/phase-<N>.phase.ts lands (plan-phase Step 6) — it was never a
# tracked file, so it is not deleted "by the commit".
#
# Usage: scripts/claim-phase-number.sh [<roadmap-root>]   (default: ./roadmap)
set -euo pipefail

ROADMAP_ROOT="${1:-roadmap}"
PHASES_DIR="$ROADMAP_ROOT/phases"
LEGACY_CLAIMS_DIR="$PHASES_DIR/.claims"

[ -d "$PHASES_DIR" ] || { echo "claim-phase-number: no such dir: $PHASES_DIR" >&2; exit 1; }

# Resolve the shared claims dir from the git common dir. --git-common-dir may be
# RELATIVE (a bare `.git`) — resolve it to absolute against the roadmap root. Not a
# git repo → fall back to the legacy per-dir location (single-checkout use).
if common_dir="$(git -C "$ROADMAP_ROOT" rev-parse --git-common-dir 2>/dev/null)"; then
  case "$common_dir" in
    /*) : ;;
    *) common_dir="$(cd "$ROADMAP_ROOT" && cd "$common_dir" && pwd)" ;;
  esac
  CLAIMS_DIR="$common_dir/zeroh-roadmap-claims"
else
  CLAIMS_DIR="$LEGACY_CLAIMS_DIR"
fi
mkdir -p "$CLAIMS_DIR"

max_declared() {
  {
    # Declared numbers in active + archived phase files (declared value, not filename)
    grep -rhoE '(^|[{,])[[:space:]]*phase:[[:space:]]*[0-9]+[[:space:]]*,' \
      "$PHASES_DIR" "$ROADMAP_ROOT/archive" 2>/dev/null \
      | grep -oE '[0-9]+' || true
    # Outstanding reservations count too — an uncommitted claim is still taken.
    # Scan BOTH the shared common dir AND the legacy per-worktree dir (transition).
    ls "$CLAIMS_DIR" 2>/dev/null | grep -oE '^[0-9]+' || true
    ls "$LEGACY_CLAIMS_DIR" 2>/dev/null | grep -oE '^[0-9]+' || true
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
