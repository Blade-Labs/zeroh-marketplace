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

# Find a real `git … commit` invocation and take its -C target FROM THE SAME
# segment, so a `git -C <path>` mentioned in a commit MESSAGE (or a different
# chained command) cannot hijack the target or the fire. Split on && || ; | ,
# then per git segment walk the pre-subcommand flags and require the subcommand to
# be EXACTLY `commit` (never commit-tree/commit-graph). `set -f` guards the
# word-split from globbing; `-c <cfg>`/`-C <dir>` config flags are handled.
target="${CWD:-.}"
cdir=""
found=0
while IFS= read -r seg; do
  seg="${seg#"${seg%%[![:space:]]*}"}" # ltrim
  while printf '%s' "$seg" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]* +'; do
    seg=$(printf '%s' "$seg" | sed -E 's/^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]* +//')
  done
  case "$seg" in git | git\ *) : ;; *) continue ;; esac
  set -f
  # shellcheck disable=SC2086
  set -- $seg
  set +f
  shift # drop 'git'
  segcdir=""
  sub=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -C) segcdir="$2"; shift 2 || break ;;
      -c) shift 2 || break ;;
      --) shift; break ;;
      -*) shift ;;
      *) sub="$1"; break ;;
    esac
  done
  if [ "$sub" = commit ]; then
    found=1
    cdir="$segcdir"
    break
  fi
done < <(printf '%s\n' "$CMD" | sed -E 's/&&/\n/g; s/\|\|/\n/g; s/[;|]/\n/g')
[ "$found" = 1 ] || exit 0
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
