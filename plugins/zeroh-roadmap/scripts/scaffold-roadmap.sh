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

# Wire the npm scripts the skills invoke. do-phase / plan-phase / full-code-review all run
# `<pm> emit:phases` to regenerate reviews/changelog.json; without this script the agent can't
# find it and skips the regen. Idempotent: existing scripts are left untouched.
if [ -f "$PROJECT_DIR/package.json" ]; then
  node - "$PROJECT_DIR/package.json" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.scripts = pkg.scripts || {};
const want = {
  'emit:phases': 'tsx lib/roadmap/emit.ts',
  'changelog:md': 'tsx scripts/generate-changelog-md.ts',
};
let changed = false;
for (const [k, v] of Object.entries(want)) {
  if (!pkg.scripts[k]) { pkg.scripts[k] = v; changed = true; console.log('  Added package.json script: ' + k); }
  else { console.log('  Skipped package.json script ' + k + ' (already set)'); }
}
if (changed) fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
NODE
else
  echo "  No package.json found — add a script manually: \"emit:phases\": \"tsx lib/roadmap/emit.ts\""
fi

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. Ensure 'zod' + 'tsx' are in your devDependencies (the emit:phases script runs tsx)."
echo "  2. Regenerate the changelog to confirm wiring: <pm> run emit:phases"
echo "  3. Create your first phase: /plan-phase"
echo "  4. Execute it: /do-phase 1"
