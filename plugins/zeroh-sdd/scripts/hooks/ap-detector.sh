#!/usr/bin/env bash
# PostToolUse hook: anti-pattern detector
#
# Reads a just-written/edited file path from stdin JSON and greps it for
# anti-patterns defined in context/ap-registry.md.
# Outputs hookSpecificOutput JSON when violations are found; exits 0 silently
# when there are none.  Never exits 2 (non-blocking PostToolUse hook).
#
# Performance budget: <200ms — uses plain grep, no interpreters for the scan.

set -euo pipefail

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# 1. Parse stdin: extract file_path from Claude Code hook JSON
# ---------------------------------------------------------------------------
input=$(cat)
file_path=$(echo "$input" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf-8'));
  console.log(d.tool_input?.file_path || '');
" 2>/dev/null || echo "")

[[ -z "$file_path" || ! -f "$file_path" ]] && exit 0

# ---------------------------------------------------------------------------
# 2. Determine file type flags
# ---------------------------------------------------------------------------
is_test_file=false
case "$file_path" in
  *.test.*|*.spec.*) is_test_file=true ;;
esac

is_ts_file=false
case "$file_path" in
  *.ts|*.tsx) is_ts_file=true ;;
esac

is_shape_file=false
case "$file_path" in
  *.shape.ts) is_shape_file=true ;;
esac

is_route_file=false
case "$file_path" in
  *route*.ts|*route*.tsx|*handler*.ts|*handler*.tsx) is_route_file=true ;;
esac

is_config_or_env_file=false
case "$file_path" in
  */config/*|*/env/*) is_config_or_env_file=true ;;
esac

# ---------------------------------------------------------------------------
# 3. Tier 1: grep-catchable checks (any eligible file, <100ms each)
# ---------------------------------------------------------------------------
violations=""

append_violation() {
  local id="$1" msg="$2" detail="$3" fix="$4"
  violations="${violations}
⚠️  ${id}: ${msg}
  File: ${file_path}${detail}
  Fix: ${fix}"
}

# AP-ERR-01: return null/undefined/[] inside a catch block
# Strategy: find catch blocks, check the next 10 lines for a bare return of null/undefined/[].
if [[ "$is_ts_file" == "true" ]]; then
  catch_lines=$(grep -n '\bcatch\b' "$file_path" 2>/dev/null | cut -d: -f1 || true)
  for catch_ln in $catch_lines; do
    end_ln=$(( catch_ln + 10 ))
    if sed -n "${catch_ln},${end_ln}p" "$file_path" 2>/dev/null \
        | grep -qE 'return\s+(null|undefined|\[\])'; then
      append_violation "AP-ERR-01" \
        "Error swallowing — catch block returns null/undefined/[]" \
        ":${catch_ln}" \
        "Use canonical error utility or re-throw with enrichment. Errors are the debugging interface."
      break  # one violation per file is enough signal
    fi
  done
fi

# AP-ERR-02: new error handler function bypassing canonical utility
if [[ "$is_ts_file" == "true" ]]; then
  match=$(grep -nE 'function (handle\w*Error|\w*[Ff]allback|create\w*Error)' "$file_path" 2>/dev/null | head -1 || true)
  if [[ -n "$match" ]]; then
    ln=$(echo "$match" | cut -d: -f1)
    append_violation "AP-ERR-02" \
      "New error handler bypassing canonical utility" \
      ":${ln}" \
      "Use the project's existing error utility. Don't create parallel error handling."
  fi
fi

# AP-ANY-01: high density of 'as any' or 'as unknown as' (>3 per file)
if [[ "$is_ts_file" == "true" ]]; then
  count=$(grep -cE '\bas any\b|\bas unknown as\b' "$file_path" 2>/dev/null || true)
  count=${count:-0}
  if (( count > 3 )); then
    append_violation "AP-ANY-01" \
      "High type assertion density (${count} occurrences)" \
      "" \
      "Fix types properly. Each 'as any' hides a potential runtime failure."
  fi
fi

# AP-DOC-01: --no-verify or --no-gpg-sign in any file
match=$(grep -nE -- '--no-verify|--no-gpg-sign' "$file_path" 2>/dev/null | head -1 || true)
if [[ -n "$match" ]]; then
  ln=$(echo "$match" | cut -d: -f1)
  append_violation "AP-DOC-01" \
    "Commit hook bypass detected" \
    ":${ln}" \
    "Never skip hooks. Fix the underlying issue that makes the hook fail."
fi

# AP-IGN-01: @ts-ignore or biome-ignore without an explanation on the same line
if [[ "$is_ts_file" == "true" ]]; then
  # A suppression directive followed immediately by end-of-comment (no trailing text) is flagged.
  match=$(grep -nE '(@ts-ignore|biome-ignore)[[:space:]]*$' "$file_path" 2>/dev/null | head -1 || true)
  if [[ -n "$match" ]]; then
    ln=$(echo "$match" | cut -d: -f1)
    append_violation "AP-IGN-01" \
      "Suppression without justification" \
      ":${ln}" \
      "Fix the underlying issue or add a comment explaining why suppression is necessary."
  fi
fi

# AP-LOG-01: console.log in non-test TypeScript files
if [[ "$is_ts_file" == "true" && "$is_test_file" == "false" ]]; then
  match=$(grep -n 'console\.log' "$file_path" 2>/dev/null | head -1 || true)
  if [[ -n "$match" ]]; then
    ln=$(echo "$match" | cut -d: -f1)
    append_violation "AP-LOG-01" \
      "console.log left in production code" \
      ":${ln}" \
      "Remove or replace with structured logging."
  fi
fi

# ---------------------------------------------------------------------------
# Closed-World Admission (CWA) — Phase B absorption from grc-zod-alpha-audit
# repo-scoped cwa-fallback-detector (2026-04-24 signal-absorption manifest).
# ---------------------------------------------------------------------------

# AP-CWA-01: `??` with non-boolean operand (nullish-coalescing default).
# Allows `?? false`, `?? true`, `?? null`, `?? undefined` which are often
# legitimate boolean-like coercions.
if [[ "$is_ts_file" == "true" ]]; then
  match=$(grep -nE '\?\?\s*[^[:space:]]' "$file_path" 2>/dev/null \
    | grep -vE '\?\?\s*(false|true|null|undefined)\b' \
    | head -1 || true)
  if [[ -n "$match" ]]; then
    ln=$(echo "$match" | cut -d: -f1)
    append_violation "AP-CWA-01" \
      "Silent default masks missing value — CWA violation" \
      ":${ln}" \
      "Replace \`??\` with explicit undefined handling or throw. Nullish-coalescing with a non-boolean RHS hides the missing-value signal."
  fi
fi

# AP-CWA-02: empty or comment-only catch block.
# Matches `catch () {}` / `catch (e) {}` / `catch { // comment }`.
if [[ "$is_ts_file" == "true" ]]; then
  match=$(grep -nE 'catch\s*\(?[^)]*\)?\s*\{\s*(//[^\n]*)?\s*\}' "$file_path" 2>/dev/null | head -1 || true)
  if [[ -n "$match" ]]; then
    ln=$(echo "$match" | cut -d: -f1)
    append_violation "AP-CWA-02" \
      "Swallowed error — catch block is empty or comment-only" \
      ":${ln}" \
      "Re-throw with context or return a typed error object. Empty catch erases diagnostic signal."
  fi
fi

# AP-CWA-03: model/provider fallback chains (routing array with provider names).
if [[ "$is_ts_file" == "true" || "$file_path" == *.json ]]; then
  match=$(grep -nE '(model|provider|fallback).*\[.*(claude|gpt|opus|sonnet|haiku|openai|anthropic|local).*\]' "$file_path" 2>/dev/null | head -1 || true)
  if [[ -n "$match" ]]; then
    ln=$(echo "$match" | cut -d: -f1)
    append_violation "AP-CWA-03" \
      "Fallback model/provider chain detected — CWA forbids silent provider substitution" \
      ":${ln}" \
      "Remove the fallback array. Primary model must fail closed. The LLM router is the sole routing point."
  fi
fi

# AP-CWA-04: wildcard SPARQL `SELECT ?s ?p ?o` read (no provenance filter).
if [[ "$is_ts_file" == "true" || "$file_path" == *.sparql ]]; then
  match=$(grep -nE 'SELECT\s+\?s\s+\?p\s+\?o' "$file_path" 2>/dev/null | head -1 || true)
  if [[ -n "$match" ]]; then
    ln=$(echo "$match" | cut -d: -f1)
    append_violation "AP-CWA-04" \
      "Wildcard read admits unchecked statements — provenance bypass" \
      ":${ln}" \
      "Narrow the query to a specific predicate + graph. Wildcard reads are forbidden under CWA."
  fi
fi

# ---------------------------------------------------------------------------
# Hardcoded Ontology Data — Phase B absorption from grc-zod-alpha-audit
# repo-scoped hardcoded-enum-detector. Multi-line awk (const-body scan).
# ---------------------------------------------------------------------------

# AP-HARD-01: const block containing >=2 CURIE/URN/IRI string values.
if [[ "$is_ts_file" == "true" ]]; then
  hard_hit=$(awk '
    /^[[:space:]]*const[[:space:]]+[A-Za-z_][A-Za-z_0-9]*[[:space:]]*[=:]/ {
      start_line = NR
      decl = $0
      in_const = 1
      hit_count = 0
      depth = 0
    }
    in_const {
      for (i=1; i<=length($0); i++) {
        c = substr($0, i, 1)
        if (c == "[" || c == "{") depth++
        if (c == "]" || c == "}") depth--
      }
      if (match($0, /"(urn:|https?:\/\/|[a-z]+:[A-Za-z])[A-Za-z0-9_:\/#\.\-]+"/)) {
        hit_count++
      }
      if (depth == 0 && NR > start_line && hit_count >= 2) {
        print start_line
        in_const = 0
        exit
      } else if (depth == 0 && NR > start_line) {
        in_const = 0
      }
    }
  ' "$file_path" 2>/dev/null | head -1 || true)
  if [[ -n "$hard_hit" ]]; then
    append_violation "AP-HARD-01" \
      "Hardcoded ontology data — should load from bundle, not inline as TS constants" \
      ":${hard_hit}" \
      "Replace the const with a bundle loader call. Ontology is data; duplicating it in code creates drift."
  fi
fi

# AP-WIRE-01: imports *Schema from shapes path but never validates (no safeParse/.parse/validatedParse)
if [[ "$is_ts_file" == "true" && "$is_shape_file" == "false" ]]; then
  if grep -qE 'Schema.*from|from.*shapes' "$file_path" 2>/dev/null; then
    if ! grep -qE 'safeParse|\.parse\(|validatedParse' "$file_path" 2>/dev/null; then
      append_violation "AP-WIRE-01" \
        "Schema imported but never parsed — unvalidated wire data" \
        "" \
        "Call safeParse(), .parse(), or validatedParse() on every schema import. Unvalidated data is a silent corruption source."
    fi
  fi
fi

# AP-WIRE-02: response.json() as <Type> — unvalidated type assertion on response data
if [[ "$is_ts_file" == "true" ]]; then
  match=$(grep -nE 'response\.json\(\)\s*as\s+' "$file_path" 2>/dev/null | head -1 || true)
  if [[ -n "$match" ]]; then
    ln=$(echo "$match" | cut -d: -f1)
    append_violation "AP-WIRE-02" \
      "Unvalidated type assertion on response.json()" \
      ":${ln}" \
      "Parse response JSON through a Zod schema (safeParse/parse) instead of casting with 'as'."
  fi
fi

# AP-WIRE-03: throw new Error(await response.text()) — destroys structured error chain
if [[ "$is_ts_file" == "true" ]]; then
  match=$(grep -nE 'throw new Error\(await.*response\.text' "$file_path" 2>/dev/null | head -1 || true)
  if [[ -n "$match" ]]; then
    ln=$(echo "$match" | cut -d: -f1)
    append_violation "AP-WIRE-03" \
      "throw new Error(response.text()) destroys structured error chain" \
      ":${ln}" \
      "Use the canonical upstream error utility (throwUpstreamError / apiError) to preserve status code, trace ID, and RFC 9457 shape."
  fi
fi

# AP-WIRE-04: catch block with throw/return but no remediation keywords
if [[ "$is_ts_file" == "true" ]]; then
  catch_lines=$(grep -n '\bcatch\b' "$file_path" 2>/dev/null | cut -d: -f1 || true)
  for catch_ln in $catch_lines; do
    end_ln=$(( catch_ln + 10 ))
    block=$(sed -n "${catch_ln},${end_ln}p" "$file_path" 2>/dev/null || true)
    # Only flag if block has a throw or return (it's not just an empty catch)
    if echo "$block" | grep -qE '\b(throw|return)\b'; then
      if ! echo "$block" | grep -qiE 'remediat|fix|check|run|verify'; then
        append_violation "AP-WIRE-04" \
          "catch block has no remediation guidance" \
          ":${catch_ln}" \
          "Every thrown error must tell the caller what to do. Add remediation text: what to run, check, or verify."
        break  # one violation per file is enough signal
      fi
    fi
  done
fi

# AP-WIRE-05: parse()/safeParse()/validatedParse() called but NO Schema/Shape
# imported in file (inverse of AP-WIRE-01 — parse without declared contract).
# Added 2026-04-24 per Phase B absorption from repo-scoped
# schema-parse-boundary-detector.
if [[ "$is_ts_file" == "true" && "$is_shape_file" == "false" ]]; then
  if grep -qE '(\bsafeParse\(|\bvalidatedParse\(|\.parse\()' "$file_path" 2>/dev/null; then
    if ! grep -qE '^\s*import\s+.*\b[A-Za-z0-9_]*(Schema|Shape)\b' "$file_path" 2>/dev/null; then
      match=$(grep -nE '(\bsafeParse\(|\bvalidatedParse\(|\.parse\()' "$file_path" 2>/dev/null | head -1 || true)
      ln=$(echo "$match" | cut -d: -f1)
      append_violation "AP-WIRE-05" \
        "Parse call without declared shape — boundary validation bypassed" \
        ":${ln}" \
        "Add \`import { FooSchema } from '...'; FooSchema.safeParse(data)\` at the boundary. Inverse of AP-WIRE-01."
    fi
  fi
fi

# AP-SHAPE-01: .shape.ts defines status/state/currentState field without discriminatedUnion
if [[ "$is_shape_file" == "true" ]]; then
  if grep -qE '\b(status|state|currentState)\b' "$file_path" 2>/dev/null; then
    if ! grep -qE 'discriminatedUnion' "$file_path" 2>/dev/null; then
      append_violation "AP-SHAPE-01" \
        "status/state field without discriminatedUnion" \
        "" \
        "Use z.discriminatedUnion() for fields that distinguish variants. Avoids invalid state combinations."
    fi
  fi
fi

# AP-SHAPE-02: .shape.ts has 2+ datetime() calls but no .refine()
if [[ "$is_shape_file" == "true" ]]; then
  dt_count=$(grep -cE 'datetime\(\)' "$file_path" 2>/dev/null || true)
  dt_count=${dt_count:-0}
  if (( dt_count >= 2 )); then
    if ! grep -qE '\.refine\(' "$file_path" 2>/dev/null; then
      append_violation "AP-SHAPE-02" \
        "Multiple datetime() fields with no temporal ordering constraint" \
        "" \
        "Add .refine() to enforce temporal ordering (e.g. startDate <= endDate). Two datetimes with no constraint invites invalid ranges."
    fi
  fi
fi

# AP-SHAPE-03: .shape.ts file with no .meta( call
if [[ "$is_shape_file" == "true" ]]; then
  if ! grep -qE '\.meta\(' "$file_path" 2>/dev/null; then
    append_violation "AP-SHAPE-03" \
      "Shape file missing .meta() annotation" \
      "" \
      "Every exported shape must have a .meta({ title, description }) call for discoverability and JSON Schema output."
  fi
fi

# AP-TEST-01: test/spec file with no @covers or @spec annotation
if [[ "$is_test_file" == "true" ]]; then
  if ! grep -qE '@covers|@spec' "$file_path" 2>/dev/null; then
    append_violation "AP-TEST-01" \
      "Test file missing @covers or @spec traceability annotation" \
      "" \
      "Add @covers <op-id> or @spec <requirement-id> to at least one test. Traceability links tests to acceptance criteria."
  fi
fi

# AP-FAT-01: route/handler file heuristic — function body > 50 lines
# Heuristic: find lines between consecutive `export` declarations; flag if gap > 50.
if [[ "$is_route_file" == "true" ]]; then
  export_lines=$(grep -n '^\(export\|export default\|export async\)' "$file_path" 2>/dev/null | cut -d: -f1 || true)
  total_lines=$(wc -l < "$file_path" 2>/dev/null || echo 0)
  prev_ln=0
  for exp_ln in $export_lines; do
    if (( prev_ln > 0 )); then
      gap=$(( exp_ln - prev_ln ))
      if (( gap > 50 )); then
        append_violation "AP-FAT-01" \
          "Route/handler function body exceeds 50 lines (~${gap} lines from export at line ${prev_ln})" \
          ":${prev_ln}" \
          "Extract logic into named helpers or op() calls. Route handlers should orchestrate, not implement."
        break  # one violation per file is enough signal
      fi
    fi
    prev_ln=$exp_ln
  done
  # Check last export to EOF
  if [[ -n "$prev_ln" && "$prev_ln" -gt 0 ]]; then
    gap=$(( total_lines - prev_ln ))
    if (( gap > 50 )); then
      append_violation "AP-FAT-01" \
        "Route/handler function body exceeds 50 lines (~${gap} lines from export at line ${prev_ln})" \
        ":${prev_ln}" \
        "Extract logic into named helpers or op() calls. Route handlers should orchestrate, not implement."
    fi
  fi
fi

# AP-ENV-01: process.env. access outside config/ or env/ directories
if [[ "$is_ts_file" == "true" && "$is_config_or_env_file" == "false" ]]; then
  match=$(grep -nE 'process\.env\.' "$file_path" 2>/dev/null | head -1 || true)
  if [[ -n "$match" ]]; then
    ln=$(echo "$match" | cut -d: -f1)
    append_violation "AP-ENV-01" \
      "process.env accessed outside config/ or env/ directory" \
      ":${ln}" \
      "Centralise all env access in a config/ or env/ module. Direct process.env calls scatter env coupling and hide missing-var failures."
  fi
fi

# ---------------------------------------------------------------------------
# 4. Tier 2: diff-catchable checks (test files only, <200ms)
# ---------------------------------------------------------------------------
if [[ "$is_test_file" == "true" ]]; then
  diff_output=$(git diff HEAD -- "$file_path" 2>/dev/null || true)

  if [[ -n "$diff_output" ]]; then
    # AP-CAP-01: toThrow removed AND toBeUndefined/toBeTruthy added
    removed_throw=$(echo "$diff_output" | grep -c '^-.*toThrow' || true)
    added_weak=$(echo "$diff_output" | grep -cE '^\+.*(toBeUndefined|toBeTruthy)' || true)
    if (( removed_throw > 0 && added_weak > 0 )); then
      append_violation "AP-CAP-01" \
        "Test assertion weakened — toThrow() changed to weaker assertion" \
        "" \
        "Fix the code to match the test, not the test to match broken code. This is test capitulation."
    fi

    # AP-CAP-02: net decrease in it()/test() count, or skip patterns added
    added_tests=$(echo "$diff_output" | grep -cE '^\+[[:space:]]*(it|test)\(' || true)
    removed_tests=$(echo "$diff_output" | grep -cE '^-[[:space:]]*(it|test)\(' || true)
    added_skips=$(echo "$diff_output" | grep -cE '^\+.*(it\.skip|xit|xtest)\(' || true)
    if (( removed_tests > added_tests || added_skips > 0 )); then
      append_violation "AP-CAP-02" \
        "Test removed or skipped" \
        "" \
        "Scaffold integrity violated. Tests derived from acceptance criteria must not be deleted. Use the variable, don't delete it."
    fi

    # AP-CAP-03: gate severity downgraded from 'error' to 'warn'
    removed_severity_error=$(echo "$diff_output" | grep -cE "^-.*severity.*['\"]error['\"]" || true)
    added_severity_warn=$(echo "$diff_output" | grep -cE "^\+.*severity.*['\"]warn['\"]" || true)
    if (( removed_severity_error > 0 && added_severity_warn > 0 )); then
      append_violation "AP-CAP-03" \
        "Gate severity downgraded from 'error' to 'warn'" \
        "" \
        "Fix the code that triggers the error, don't lower the gate. Severity downgrades are silent test capitulation."
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 5. Emit output or exit silently
# ---------------------------------------------------------------------------
[[ -z "$violations" ]] && exit 0

# Trim leading newline from violations string
violations="${violations#$'\n'}"

context_text="Anti-pattern violations detected in ${file_path}:

${violations}"

escaped=$(printf '%s' "$context_text" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")

printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":%s}}\n' "$escaped"
