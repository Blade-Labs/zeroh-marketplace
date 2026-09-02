#!/usr/bin/env bash
# scaffold-roadmap.sh — Initialize phase-driven roadmap in a project
#
# Usage: scaffold-roadmap.sh [PROJECT_DIR] [--root <dir>]
#   --root defaults to `roadmap`; `--root docs/roadmap` puts the whole consumer under
#   docs/roadmap/ beside a sibling docs folder. Everything lands UNDER the root, including the
#   schema seam — which is what lets a phase file import `../lib/schema` relatively, with no
#   tsconfig path alias. The legacy toplevel `lib/roadmap/schema.ts` seam stays recognized by
#   cli/lib/roadmap-root.mjs, so existing consumers are untouched.
#
# Creates (<root> = --root, default `roadmap`):
#   <root>/lib/schema.ts     — definePhase() + Zod shapes
#   <root>/lib/registry.ts   — Phase discovery (dynamic import + validation)
#   <root>/lib/emit.ts       — Registry emission (deterministic JSON + digest)
#   <root>/ROADMAP.md        — Validation gate + git strategy
#   <root>/backlog.ts        — Ordered execution queue
#   <root>/phases/           — Empty phases directory
#   reviews/releases/         — Release review reports directory
#   scripts/pre-review.sh     — Automated pre-review checks
#   scripts/collect-phase-metrics.ts — Gate + git metrics collector
#   scripts/build-dashboard.sh — Review dashboard HTML generator

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="."
ROOT="roadmap"
while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      ROOT="${2:?--root needs a directory}"
      shift 2
      ;;
    --root=*)
      ROOT="${1#--root=}"
      shift
      ;;
    *)
      PROJECT_DIR="$1"
      shift
      ;;
  esac
done

# REFUSE rather than create a second root. Two marked roots is the ambiguity
# cli/lib/roadmap-root.mjs refuses to resolve, so scaffolding one into existence would hand the
# consumer a repo no command can read. A marker is roadmap.config.json or phases/ — the same
# two the resolver probes.
for candidate in roadmap docs/roadmap; do
  [ "$candidate" = "$ROOT" ] && continue
  if [ -f "$PROJECT_DIR/$candidate/roadmap.config.json" ] || [ -d "$PROJECT_DIR/$candidate/phases" ]; then
    echo "scaffold-roadmap: $PROJECT_DIR already carries a roadmap root at $candidate — refusing to create a second one at $ROOT." >&2
    echo "  Two roots means two backlogs and two registries, and every command would refuse to pick between them. Scaffold into $candidate, or move it first." >&2
    exit 1
  fi
done

echo "=== Scaffolding zeroh-roadmap in $PROJECT_DIR (root: $ROOT) ==="

# Create directories
mkdir -p "$PROJECT_DIR/$ROOT/lib"
mkdir -p "$PROJECT_DIR/$ROOT/phases"
mkdir -p "$PROJECT_DIR/reviews/releases"
mkdir -p "$PROJECT_DIR/scripts"

# Copy <root>/lib templates — schema, registry, emit. This is the seam a phase file reaches with
# a RELATIVE `../lib/schema`; no tsconfig `paths` alias is required of the consumer.
for lib_file in schema.ts registry.ts emit.ts; do
  if [ ! -f "$PROJECT_DIR/$ROOT/lib/$lib_file" ]; then
    cp "$PLUGIN_DIR/templates/$lib_file" "$PROJECT_DIR/$ROOT/lib/$lib_file"
    echo "  Created $ROOT/lib/$lib_file"
  else
    echo "  Skipped $ROOT/lib/$lib_file (already exists)"
  fi
done

# Copy ROADMAP.md
if [ ! -f "$PROJECT_DIR/$ROOT/ROADMAP.md" ]; then
  cp "$PLUGIN_DIR/templates/ROADMAP.md" "$PROJECT_DIR/$ROOT/ROADMAP.md"
  echo "  Created $ROOT/ROADMAP.md"
else
  echo "  Skipped $ROOT/ROADMAP.md (already exists)"
fi

# Copy backlog.ts (ordered execution queue)
if [ ! -f "$PROJECT_DIR/$ROOT/backlog.ts" ]; then
  cp "$PLUGIN_DIR/templates/backlog.ts" "$PROJECT_DIR/$ROOT/backlog.ts"
  echo "  Created $ROOT/backlog.ts"
else
  echo "  Skipped $ROOT/backlog.ts (already exists)"
fi

# Scaffold roadmap/arcs/ (OPT-IN — arcs are optional; defineArc rides along via schema.ts).
# Deliberately NOT in audit REQUIRED_ARTIFACTS: a repo without arcs is fully valid.
# The directory only, never an example arc file: anything landing here is a LIVE arc, so a
# copied example makes id A with phases [1] real in a consumer that has authored none.
# templates/example.arc.ts stays installed with the plugin as reference material.
mkdir -p "$PROJECT_DIR/$ROOT/arcs"

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
  node - "$PROJECT_DIR/package.json" "$ROOT" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.scripts = pkg.scripts || {};
const root = process.argv[3];
const want = {
  'emit:phases': `tsx ${root}/lib/emit.ts`,
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
  echo "  No package.json found — add a script manually: \"emit:phases\": \"tsx $ROOT/lib/emit.ts\""
fi

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. Ensure 'zod' + 'tsx' are in your devDependencies (the emit:phases script runs tsx)."
echo "  2. Regenerate the changelog to confirm wiring: <pm> run emit:phases"
echo "  3. Create your first phase: /plan-phase"
echo "  4. Execute it: /do-phase 1"
