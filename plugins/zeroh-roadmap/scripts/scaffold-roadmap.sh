#!/usr/bin/env bash
# scaffold-roadmap.sh — Initialize phase-driven roadmap in a project
#
# Creates:
#   lib/roadmap/schema.ts    — definePhase() + Zod shapes
#   lib/roadmap/registry.ts  — Phase discovery (dynamic import + validation)
#   lib/roadmap/emit.ts      — Registry emission (deterministic JSON + digest)
#   roadmap/ROADMAP.md       — Validation gate + git strategy
#   roadmap/backlog.ts        — Ordered execution queue
#   roadmap/phases/           — Empty phases directory
#   reviews/releases/         — Release review reports directory
#   scripts/pre-review.sh     — Automated pre-review checks
#   scripts/collect-phase-metrics.ts — Gate + git metrics collector
#   scripts/build-dashboard.sh — Review dashboard HTML generator

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="${1:-.}"

echo "=== Scaffolding zeroh-roadmap in $PROJECT_DIR ==="

# Create directories
mkdir -p "$PROJECT_DIR/lib/roadmap"
mkdir -p "$PROJECT_DIR/roadmap/phases"
mkdir -p "$PROJECT_DIR/reviews/releases"
mkdir -p "$PROJECT_DIR/scripts"

# Copy lib/roadmap templates — schema, registry, emit
for lib_file in schema.ts registry.ts emit.ts; do
  if [ ! -f "$PROJECT_DIR/lib/roadmap/$lib_file" ]; then
    cp "$PLUGIN_DIR/templates/$lib_file" "$PROJECT_DIR/lib/roadmap/$lib_file"
    echo "  Created lib/roadmap/$lib_file"
  else
    echo "  Skipped lib/roadmap/$lib_file (already exists)"
  fi
done

# Copy ROADMAP.md
if [ ! -f "$PROJECT_DIR/roadmap/ROADMAP.md" ]; then
  cp "$PLUGIN_DIR/templates/ROADMAP.md" "$PROJECT_DIR/roadmap/ROADMAP.md"
  echo "  Created roadmap/ROADMAP.md"
else
  echo "  Skipped roadmap/ROADMAP.md (already exists)"
fi

# Copy backlog.ts (ordered execution queue)
if [ ! -f "$PROJECT_DIR/roadmap/backlog.ts" ]; then
  cp "$PLUGIN_DIR/templates/backlog.ts" "$PROJECT_DIR/roadmap/backlog.ts"
  echo "  Created roadmap/backlog.ts"
else
  echo "  Skipped roadmap/backlog.ts (already exists)"
fi

# Copy scripts
for script in pre-review.sh collect-phase-metrics.ts build-dashboard.sh generate-changelog-md.ts; do
  if [ ! -f "$PROJECT_DIR/scripts/$script" ]; then
    if [ -f "$PLUGIN_DIR/scripts/$script" ]; then
      cp "$PLUGIN_DIR/scripts/$script" "$PROJECT_DIR/scripts/$script"
      echo "  Created scripts/$script"
    fi
  else
    echo "  Skipped scripts/$script (already exists)"
  fi
done

# Make shell scripts executable
chmod +x "$PROJECT_DIR/scripts/"*.sh 2>/dev/null || true

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. Ensure 'zod' is in your dependencies: pnpm add zod"
echo "  2. Create your first phase: /plan-phase"
echo "  3. Execute it: /do-phase 1"
