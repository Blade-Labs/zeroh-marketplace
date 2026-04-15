#!/usr/bin/env bash
# session-start.sh — SessionStart hook: pipeline state + context recovery
set -uo pipefail

input=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

# Extract resume type
resume_type=$(echo "$input" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf-8'));
  console.log(d.resume_type || 'fresh');
" 2>/dev/null || echo "fresh")

# Create session directory
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
slug=$(echo "$branch" | tr '/' '-')
date_prefix=$(date +%Y-%m-%d)
session_dir="$PROJECT_DIR/.vibe/${date_prefix}_${slug}"
mkdir -p "$session_dir" 2>/dev/null || true

echo "=== zeroh-sdd ==="
echo "Branch: $branch"

# Detect SDD project
spec_dirs=()
for dir in specs .specify; do
  [[ -d "$PROJECT_DIR/$dir" ]] && spec_dirs+=("$dir")
done

if [[ ${#spec_dirs[@]} -eq 0 ]]; then
  echo "No SDD artifacts found. Run /zeroh-sdd:speckit-specify to start."
  echo "=== Ready ==="
  exit 0
fi

# Report pipeline state
echo ""
echo "SDD Pipeline State:"
# Find most recent spec directory
latest_spec=""
if [[ -d "$PROJECT_DIR/specs" ]]; then
  latest_spec=$(ls -td "$PROJECT_DIR/specs"/*/ 2>/dev/null | head -1)
fi

if [[ -n "$latest_spec" ]]; then
  spec_name=$(basename "$latest_spec")
  echo "  Active spec: $spec_name"
  [[ -f "$latest_spec/spec.md" ]] && echo "  ✓ spec.md" || echo "  ○ spec.md (missing)"
  [[ -f "$latest_spec/plan.md" ]] && echo "  ✓ plan.md" || echo "  ○ plan.md"

  # Shape briefs check
  shape_count=0
  if [[ -d "$latest_spec/shape-briefs" ]]; then
    shape_count=$(ls -1 "$latest_spec/shape-briefs"/*.brief.md 2>/dev/null | wc -l | tr -d ' ')
  fi
  [[ $shape_count -gt 0 ]] && echo "  ✓ shape-briefs/ ($shape_count briefs)" || echo "  ○ shape-briefs/"

  [[ -f "$latest_spec/tasks.md" ]] && echo "  ✓ tasks.md" || echo "  ○ tasks.md"

  # Determine current phase
  if [[ ! -f "$latest_spec/spec.md" ]]; then
    echo "  Phase: SPECIFY"
  elif [[ ! -f "$latest_spec/plan.md" ]]; then
    echo "  Phase: PLAN"
  elif [[ $shape_count -eq 0 ]]; then
    echo "  Phase: SHAPES ⚠️  Plan complete but shapes not produced"
    echo "  → Run /speckit-shapes to produce shape briefs before /speckit-tasks"
  elif [[ ! -f "$latest_spec/tasks.md" ]]; then
    echo "  Phase: TASKS"
  else
    echo "  Phase: IMPLEMENT"
  fi
fi

# Context recovery on resume/compact
if [[ "$resume_type" == "compact" || "$resume_type" == "resume" ]]; then
  snapshot="$PROJECT_DIR/.vibe/context-snapshot.md"
  if [[ -f "$snapshot" ]]; then
    age_hours=$(( ($(date +%s) - $(stat -c %Y "$snapshot" 2>/dev/null || echo 0)) / 3600 ))
    if [[ $age_hours -lt 24 ]]; then
      echo ""
      echo "Context recovered from snapshot (${age_hours}h old):"
      head -30 "$snapshot"
    fi
  fi
fi

# Uncommitted work awareness
uncommitted=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [[ "$uncommitted" -gt 0 ]]; then
  echo ""
  echo "Uncommitted files: $uncommitted"
  git status --short 2>/dev/null | head -10
fi

echo ""
echo "=== Ready ==="
