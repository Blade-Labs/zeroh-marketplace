#!/usr/bin/env bash
# roadmap-root.sh — the SHELL twin of cli/lib/roadmap-root.mjs. Same candidate order, same
# markers, same override rule; the two exist separately only because a hook cannot afford to
# spawn node on every tool call. A change to either is a change to both.
#
# Sourced, never executed: `. "$(dirname "$0")/lib/roadmap-root.sh"`.
#
#   roadmap_root <dir>   echoes the resolved root and returns 0
#                        returns 1, after ONE stderr line, when <dir> is ambiguous
#
# The ambiguity return is the one difference in FORM from the mjs twin, and none in meaning:
# the CLI throws, a hook must never block a session, so the caller maps a non-zero return to a
# silent `exit 0`. What both refuse to do is GUESS — two marked roots means two backlogs and two
# registries, and picking one is how half a consumer's records go quietly unread.

roadmap_root() {
  local dir="$1"

  # The override names where the root WILL be, so it is never probed for existence.
  if [ -n "${ROADMAP_ROOT:-}" ]; then
    case "$ROADMAP_ROOT" in
      /*) printf '%s\n' "$ROADMAP_ROOT" ;;
      *) printf '%s\n' "$dir/$ROADMAP_ROOT" ;;
    esac
    return 0
  fi

  # ROOT_CANDIDATES, in precedence order. A MARKER (roadmap.config.json or phases/) is what makes
  # a candidate a root: an existing but unmarked directory is not one, or a repo with a prose
  # docs/roadmap/ folder would stop reading its real roadmap/.
  local marked=()
  local candidate
  for candidate in roadmap docs/roadmap; do
    if [ -f "$dir/$candidate/roadmap.config.json" ] || [ -d "$dir/$candidate/phases" ]; then
      marked+=("$dir/$candidate")
    fi
  done

  if [ "${#marked[@]}" -gt 1 ]; then
    echo "roadmap: $dir carries more than one roadmap root — ${marked[*]} — each holds its own records, so reading either one silently hides the other; delete or merge the one that is not yours, or name the real root with ROADMAP_ROOT=<dir>" >&2
    return 1
  fi

  if [ "${#marked[@]}" -eq 1 ]; then
    printf '%s\n' "${marked[0]}"
  else
    printf '%s\n' "$dir/roadmap"
  fi
}
