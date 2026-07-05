#!/usr/bin/env bash
# PostToolUse hook (Bash) — stamp a liveness BEACON when a commit lands inside a
# registered arc worktree, so an executor emits a positive heartbeat it cannot
# forget (the one-commit-per-task ritual carries it — it is not the executor's job).
#
# The beacon is append-only JSONL at <main-checkout>/roadmap/arcs/.building/
# <ARC-ID>-executor.jsonl, read by scripts/executor-liveness.mjs and arc-status.mjs.
#
# REGISTRY DISCOVERY (the trap): the .building sidecars live ONLY in the MAIN
# checkout — the dir is gitignored, so a worktree's own roadmap/arcs/.building/ is
# EMPTY. Resolve the main checkout from the commit target via the git COMMON dir,
# never cwd-relative, and append the beacon THERE (where arc-status reads it).
#
# NEVER blocks: a beacon failure must not fail a commit — always exit 0, log stamp
# errors to stderr only. Fires on git commit; every other command exits 0 fast.

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -z "$CMD" ] && exit 0

# Only fire on `git commit` / `git -C <dir> commit`.
printf '%s' "$CMD" | grep -qE '\bgit\b([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+commit\b' || exit 0

# The commit target dir: an explicit `git -C <dir>`, else the payload cwd.
target="${CWD:-.}"
cdir=$(printf '%s' "$CMD" | grep -oE '\bgit[[:space:]]+-C[[:space:]]+[^[:space:]]+' | head -1 | awk '{print $NF}')
if [ -n "$cdir" ]; then
  case "$cdir" in
    /*) target="$cdir" ;;
    *) target="${CWD:-.}/$cdir" ;;
  esac
fi

# Main checkout = parent of the git COMMON dir (shared by every worktree).
common=$(git -C "$target" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
main=$(dirname "$common")
registry="$main/roadmap/arcs/.building"
[ -d "$registry" ] || exit 0

realtarget=$(realpath "$target" 2>/dev/null) || realtarget="$target"

# Find the sidecar whose worktree CONTAINS the commit target (realpath prefix).
arcid=""
wt=""
for sc in "$registry"/*.json; do
  [ -e "$sc" ] || continue
  case "$sc" in *-executor.jsonl) continue ;; esac  # never treat a beacon as a sidecar
  wtraw=$(jq -r '.worktree // empty' "$sc" 2>/dev/null)
  if [ $? -ne 0 ]; then echo "beacon-stamp: malformed sidecar $sc" >&2; continue; fi
  [ -n "$wtraw" ] || continue
  realwt=$(realpath "$wtraw" 2>/dev/null) || realwt="$wtraw"
  case "$realtarget/" in
    "$realwt"/*)
      arcid=$(jq -r '.arcId // empty' "$sc" 2>/dev/null)
      wt="$realwt"
      break
      ;;
  esac
done
[ -n "$arcid" ] || exit 0

# Stamp AFTER the commit (PostToolUse guarantees it landed). `phase` is nullable —
# best-effort from the subject; never fabricate a number.
subject=$(git -C "$wt" log -1 --format='%h %s' 2>/dev/null) || exit 0
phasenum=$(printf '%s' "$subject" | grep -oiE 'phase[[:space:]]+[0-9]+' | grep -oE '[0-9]+' | head -1)
[ -n "$phasenum" ] && phasejson="$phasenum" || phasejson="null"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
beacon="$registry/$arcid-executor.jsonl"

jq -cn --arg ts "$ts" --argjson phase "$phasejson" --arg detail "$subject" \
  '{ts:$ts, phase:$phase, event:"commit", detail:$detail}' >> "$beacon" 2>/dev/null \
  || echo "beacon-stamp: failed to append $beacon" >&2
exit 0
