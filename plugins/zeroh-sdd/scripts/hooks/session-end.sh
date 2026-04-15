#!/usr/bin/env bash
# session-end.sh — SessionEnd hook: archive transcript to .vibe/
# Non-blocking. Failures are silenced so they never interrupt Claude.
set -uo pipefail

input=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

# Extract session info from event payload
session_id=$(echo "$input" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf-8'));
  console.log(d.session_id || 'unknown');
" 2>/dev/null || echo "unknown")

reason=$(echo "$input" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf-8'));
  console.log(d.stop_reason || 'unknown');
" 2>/dev/null || echo "unknown")

# Skip on main/master (no feature transcripts to archive)
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
[[ "$branch" == "main" || "$branch" == "master" ]] && exit 0

# Archive transcript if the path is present and the file exists
transcript_path=$(echo "$input" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf-8'));
  console.log(d.transcript_path || '');
" 2>/dev/null || echo "")

if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
  slug=$(echo "$branch" | tr '/' '-')
  archive_dir="$PROJECT_DIR/.vibe/${slug}"
  mkdir -p "$archive_dir"
  archive_file="${archive_dir}/session_${session_id}_${reason}.jsonl.gz"
  gzip -c "$transcript_path" > "$archive_file" 2>/dev/null || true
fi

exit 0
