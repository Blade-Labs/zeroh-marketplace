---
name: full-code-review
description: Comprehensive codebase audit using 8 parallel specialist agents. Covers security, dead code, DRY violations, performance, architecture, edge cases, data flow, and financial correctness. Required before every release to production.
argument-hint: "[path or scope]"
---

# Full Code Review (Pre-Release Gate)

Comprehensive local code audit using parallel specialist agents. **Required before every merge to main / deploy to production.** Covers security, dead code, DRY, optimization, architecture, edge cases, data flow, and financial calculation correctness.

**Consumer override rule:** if the consumer repo ships its own tailored release-review skill
(e.g. a `release-review` with agents tuned to its domain invariants), **that skill supersedes
this generic one** — say so and run the consumer's instead. This generic review is the
fallback for consumers without one.

## Arguments

User instructions: $ARGUMENTS

Parse arguments to determine:
- **Scope**: Specific path/directory/file, or entire project if omitted
- **Focus**: If specific concerns mentioned, narrow the review. Otherwise run all 8 agents.

## Phase 1: Discovery

Before dispatching review agents, build a codebase map:

1. Identify project type, language(s), framework(s), build system from config files
2. Find entry points: main files, index files, route definitions, top-level exports
3. Read CLAUDE.md for project-specific conventions
4. Read the consumer's prior review reports if present (`reviews/releases/*.json` + any audit reports in `reviews/`) — agents must check for REGRESSIONS against previously fixed findings
5. Map directory structure and key modules
6. Note the tech stack version — agents need this to check against current best practices

Output a brief codebase summary, then proceed to Phase 2.

## Phase 2: Dispatch 8 Parallel Agents

Launch all 8 agents in a single message using the Agent tool. Pass each agent:
- The codebase summary from Phase 1
- The target scope (path or full project)
- Its specific mission below
- Reference to prior security audit findings for regression checking

Every agent must:
- Read actual source files thoroughly — not just list them
- Trace through code paths to understand behavior
- Return findings as structured list: `[severity: critical|high|medium|low] file:line — description`
- Include the relevant code snippet for each finding
- Only report findings with >=80% confidence (raised from 70% based on experience — reduces noise)
- Be thorough — prioritize correctness over speed

---

### Agent 1: Security & Auth (`code-reviewer`)

**OWASP Top 10 + project-specific security audit.** This agent catches vulnerabilities that block production release.

Check every auth route, middleware, and session handler for:
- **Authentication bypass**: public paths that should require auth, `startsWith` prefix matching on paths (allows `/api/mat/auth/login-anything` to bypass)
- **Authorization gaps**: missing cycle membership checks, IDOR via leaked UUIDs, indirect table access without parent verification
- **Token security**: plaintext tokens in DB (must use sha256 hash), replayable tokens (must be single-use), token expiry enforcement
- **Rate limiting**: every public endpoint must call both `isLimited()` AND `record()` — check for the common bug of calling `isLimited` without `record`
- **Input validation**: Zod schemas on all API route inputs (not raw `as` casts), email format validation, max length on strings
- **Account enumeration**: auth endpoints must not reveal whether an account exists (use generic responses)
- **Session management**: sessions invalidated on password change, cookie flags (HttpOnly, Secure, SameSite), session TTL
- **XSS vectors**: user input interpolated into HTML emails must use `escapeHtml()`, no `dangerouslySetInnerHTML`, no `eval()`
- **Exposed secrets**: credentials in client bundle (`NEXT_PUBLIC_*` with secrets), hardcoded API keys, credentials in git
- **Security headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options in next.config or middleware
- **File upload/download**: path traversal protection, MIME validation, cycle-scoped authorization on both upload AND download
- **Environment variable consistency**: server-only vars not accidentally exposed as `NEXT_PUBLIC_*`, client and server reading different env var names for the same config

Cross-reference with the consumer's prior security-audit reports under `reviews/` (when present) — flag any REGRESSIONS from previously fixed findings.

---

### Agent 2: Dead Code & Dead References (`code-reviewer`)

Identify all dead code in the codebase:
- Unused exports, functions, classes, variables, and type definitions
- Unreachable code branches (after early returns, impossible conditions)
- **Orphaned modules** — fully implemented files not imported by any production code (business-rules that are tested but never wired). This is a critical pattern in this codebase.
- Unused imports and dependencies (check package.json too)
- Commented-out code blocks (flag for removal)
- Stale references to renamed or removed code
- **Deprecated shims** — re-export files left after refactoring

Method: Trace the module/import graph from entry points outward. For each export in `lib/business-rules/`, `lib/services/`, verify at least one PRODUCTION import exists (not just tests).

---

### Agent 3: DRY Violations & Duplication (`code-reviewer`)

Find duplicated logic that hurts maintainability:
- Copy-pasted code blocks (3+ lines substantially similar)
- Near-identical functions or components that differ only in small details
- Repeated constants, magic numbers, or config values that should be centralized
- Duplicated error handling, validation, or transformation patterns
- **Duplicated security logic** — especially authorization checks that should use shared services (e.g., `authorizeFileAccess`)
- **Weaker copies** of shared utilities (e.g., local `escapeHtml` missing single-quote escape vs shared version)
- Similar API call patterns that should share a utility

For each finding, suggest the specific abstraction or refactor. Only flag duplication where an abstraction genuinely improves maintainability.

---

### Agent 4: Performance & Optimization (`code-reviewer`)

Identify performance issues with measurable impact:
- Algorithmic inefficiency (O(n^2) where O(n) is possible, multi-pass where single-pass works)
- Unnecessary React re-renders (missing `useMemo`, unstable references in deps arrays)
- **`useEffect` + `db.from()` bypassing React Query** — this is a common anti-pattern in this codebase. Data should go through `useQuery` for caching/dedup, or filter from existing context data
- N+1 query patterns in database access
- Missing memoization where computation is expensive and inputs repeat
- Large dependency imports that could be lazy-loaded
- Memory leaks (event listeners not cleaned up, subscriptions not unsubscribed)
- Redundant network calls or computations
- **CPU-bound work inside DB transactions** (e.g., password hashing holding a connection)

Skip micro-optimizations. Focus on changes that would noticeably improve UX or resource usage.

---

### Agent 5: Architecture & Best Practices (`code-reviewer`)

Evaluate architecture against best practices for the specific tech stack:
- **Business logic layer purity**: `lib/business-rules/` must be pure functions (no DB imports, no side effects). Flag any DB calls in this directory.
- **Testability**: business-rule functions must accept injectable `now` parameter (not inline `Date.now()`). Flag any that don't.
- Separation of concerns: business logic mixed with UI? Data access in components?
- Dependency direction: do lower layers depend on higher layers?
- Framework-specific patterns: proper use of hooks, middleware, routing, state management
- Error handling strategy: consistent? Complete? Proper use of error boundaries?
- Type safety: `any` usage, loose types where strict would prevent bugs, unsafe casts (e.g., `as UserRole` on unvalidated input)
- **Single source of truth violations**: duplicate env var names for client/server, hardcoded role lists instead of importing `ALL_USER_ROLES`, financial constants defined in multiple places
- API design: consistent naming, proper status codes, canonical error utility with structured context

Reference CLAUDE.md conventions. Check against PRIME DIRECTIVE (errors must surface with context — no fallbacks, no swallowed errors, no null returns).

---

### Agent 6: Edge Cases & Potential Bugs (`code-reviewer`)

Trace every data flow path and look for:
- Unhandled null/undefined access
- Missing error boundaries or try/catch where external calls can fail
- Race conditions in async code (stale closures, concurrent state mutations)
- **Transaction gaps**: multi-step DB operations not wrapped in `db.transaction()` (token mark + user create + membership assign should be atomic)
- Type coercion bugs
- Off-by-one errors in loops, slicing, pagination
- Missing input validation at system boundaries (user input, API params, env vars)
- State inconsistencies (optimistic updates without rollback, partial failure states)
- **Orphaned DB records**: operations that persist data before a subsequent step that can fail (e.g., token created before email sent — if email fails, token is orphaned)

For each finding, describe the specific scenario that triggers the bug.

---

### Agent 7: Data Flow & Integration Integrity (`code-reviewer`)

Trace the complete data lifecycle:
- Map external inputs: APIs, user input, env vars, file reads, DB queries
- Follow data through processing layers to outputs: responses, DB writes, side effects
- Verify data transformations are correct at each step (especially cents/dollars conversions)
- Check type consistency across module/function boundaries
- Verify error propagation is complete — no swallowed errors, no silent failures
- Confirm API contracts match between caller and callee (request/response shapes)
- **Environment variable audit**: every env var referenced in code must be set in deploy config (`service-template.yaml` or workflow env block). Flag any referenced but unconfigured vars.
- Verify third-party integrations handle failure modes (SendGrid email, GCS storage, pg connection)
- **URL construction**: all action links in emails must use centralized `APP_BASE_URL`, not inline `process.env.APP_URL`

---

### Agent 8: Financial Calculation Correctness (`code-reviewer`)

**Critical for a financial platform.** Verify all monetary calculations are correct and consistent:

- **Cents/Dollars consistency**: all monetary storage in integer cents (`_cents` fields), display via `formatCurrencyCents()`, no inline `/ 100` or `* 100`
- **Calculation consistency**: every location that computes the same value must include the same inputs (check for divergent calculation paths)
- **Profit split correctness**: `calculateProfitSplit` handles edge cases (no profit → mudarib gets 0 per Cl. 8.3, losses borne by investor per Cl. 8.4)
- **Financial event type coverage**: `AMOUNT_FIELDS`, `DEBIT_EVENT_TYPES`, `CREDIT_EVENT_TYPES`, `REVENUE_EVENT_TYPES`, `TOTAL_INCOME_EVENT_TYPES` — verify they contain the right event types and are used in the right contexts
- **Rounding**: financial assertions use exact integers (`toBe`), not `toBeCloseTo`
- **Trial balance**: debits = credits (double-entry accounting invariant)
- **Settlement calculation**: matches what dashboards show — no discrepancy between unrealized P&L and final settlement

---

## Phase 3: Consolidate & Triage

After all agents return:

1. **Deduplicate** — merge overlapping findings from different agents
2. **Cross-reference** — if Agent 6 found a bug in code Agent 2 flagged as dead, drop the bug
3. **Regression check** — compare Agent 1 (security) findings against prior security audit. Flag any previously-fixed issues that reappeared.
4. **Triage by severity:**
   - **Critical**: Security vulnerabilities, financial calculation errors, data corruption, runtime crashes. **BLOCKS RELEASE.**
   - **High**: Architectural issues, significant DRY violations, meaningful perf problems, orphaned business rules
   - **Medium**: Code quality issues, minor optimization opportunities, non-critical edge cases
   - **Low**: Style inconsistencies, minor dead code, improvement suggestions

## Phase 4: Report + Consolidated Issue List

Present findings as a **single numbered master list** grouped by severity. Every finding gets an ID (e.g., `FCR-1`, `FCR-2`, ...) that carries through to the phase file.

```markdown
# Full Code Review — [date]

## Master Issue List

### Critical (X findings) — RELEASE BLOCKERS

**FCR-1** · `file.ts:42` · [Agent 1: Security] · **Token stored in plaintext**
> Regression from security audit A-5
\`\`\`typescript
// code snippet showing the problem
\`\`\`
- **Problem**: What goes wrong, when, and what breaks
- **Fix**: Specific remediation steps
- **Regression**: Yes/No

**FCR-2** · `file.ts:88` · [Agent 8: Financial] · **Cents displayed as dollars**
...

### High (X findings)

**FCR-3** · ...

### Medium (X findings)

**FCR-N** · ...

### Low (X findings)

**FCR-N** · ...

---

## Security Regression Check
- Previously fixed items verified: X/Y
- Regressions found: [list or "none"]

## Summary
- X critical, Y high, Z medium, W low findings
- Release decision: BLOCKED (if critical > 0) or CLEAR
- Top 3 areas needing attention
- Overall code health assessment
```

## Phase 5: Create Remediation Phase File

After presenting the report, **automatically create a new phase file** in `roadmap/phases/`. This is mandatory — do not ask, just create it.

### Step 1: Determine the next phase number
`roadmap claim` reserves the next monotonic number (never reuse a historical one, even a vacant slot).

### Step 2: Write the phase file

Create `roadmap/phases/phase-{N}.phase.ts` via `definePhase()`. Map every finding from the master list into
a task; group related findings sharing a fix into the same task (e.g. multiple auth findings in one file).

```typescript
import { definePhase } from '../../lib/roadmap/schema'

export default definePhase({
  phase: {N},
  name: 'Code Review Remediation',
  status: 'backlog',
  category: 'fix',
  source: 'Full code review ({date})',
  priority: '{BLOCKER if any critical, HIGH if only high, MEDIUM otherwise}',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [/* list top files from findings */],
  stakeholderDemo:
    'All code review findings from the {date} audit are resolved — security, financial correctness, and code quality verified.',

  tasks: [
    {
      id: '{N}.1',
      title: '{Group label: e.g., "Fix critical security findings"}',
      problem: '{Problem context — why these matter, what breaks}',
      steps: [
        { file: 'path/to/file.ts', description: 'FCR-1: {description}' },
        { file: 'path/to/file.ts', description: 'FCR-2: {description}' },
      ],
      acceptanceCriteria: ['{Observable outcome}', '{Observable outcome}'],
      files: ['path/to/file1.ts', 'path/to/file2.ts'],
      done: false,
    },
    // ... more tasks ...
    {
      id: '{N}.{last}',
      title: 'Run validation gate on all fixes',
      problem:
        'Gate must pass after all findings are resolved to confirm no regressions.',
      steps: [
        { file: 'package.json', description: 'Run the lint, types, unit, and build slots (`gateCommands` config)' },
        { file: 'CLAUDE.md', description: 'Re-run /full-code-review — zero critical/high findings' },
      ],
      acceptanceCriteria: ['All gate steps pass', 'Zero critical/high findings on re-run'],
      files: ['package.json'],
      done: false,
    },
  ],
})
```

**Grouping rules for tasks:**
- All **critical** findings → first task(s), one task per security domain (auth, storage, financial)
- All **high** findings → next tasks, grouped by domain (dead code, architecture, performance)
- All **medium** findings → grouped loosely by file/area, max 5 items per task
- **Low** findings → single task "Low-priority cleanup" with all items listed

Each task must follow the `PhaseTaskShape` from `lib/roadmap/schema.ts`: `problem` field, `steps` with file paths, `acceptanceCriteria`, `files` list.

### Step 3: Commit the phase file

```bash
git add roadmap/phases/phase-{N}.phase.ts
git commit -m "docs(roadmap): phase {N} — code review remediation from {date} audit"
```

After committing, run the `emit` slot to regenerate `reviews/changelog.json`.

### Step 4: Save review to `reviews/`

Also save the full report as `reviews/{date}-FULL-CODE-REVIEW.md` for historical reference. Commit alongside the phase file.

### Step 5: Serialize findings to JSON + append to the release review report

Serialize the consolidated results to `reviews/releases/v{version}-review.json` (version from
`package.json`). If the file exists, MERGE this run as additional rounds (append to `rounds[]` +
`findings[]`); else create it from the schema of the existing `reviews/releases/` files. Each `rounds[]`
entry: `{ round, agents:[{name, findings}], verdict }`; each `findings[]` entry: `{ severity, description,
resolution|null, round, agent }`; top-level `{ version, date, verdict }`. Validate the `gate` section
against `GateResultShape` (`lib/roadmap/schema.ts` — lint/typeCheck/build + test counts present +
well-formed). Then rebuild the dashboard (`bash scripts/build-dashboard.sh`) and commit both files
(`docs(reviews): v{version} — code review round {N}, {X} findings`).

### Step 6: Update gate test counts
Run the consumer's `unit`/`integration`/`e2e` slots, capture the pass counts, and update the review JSON
`gate` section (`unitTests: {passed, total}`, etc.).

### Step 7: Present next steps
Tell the user: the phase file path + number, task count, whether it's release-blocking (any critical
finding), the review JSON path, and "Run `do phase {N}` to start remediation".

---

## Phase 6: Post-Remediation Update (after fixing findings)

After the remediation phase completes (all tasks done, gate passed), update
`reviews/releases/v{version}-review.json`:
1. **Finding resolutions** — each fixed → `"resolution": "Fixed in phase {N}.{X} — …"`; each deferred →
   `"Deferred to Phase {M} — {reason}"`; no unexplained `null`.
2. **Verdict** — all critical+high resolved → `"RELEASED"`; any critical unresolved → `"BLOCKED"`.
3. **Gate counts** — re-run tests, update the `gate` section (as Step 6).
4. **Deferred list** — if any deferred, add `"deferredToBacklog": ["FCR-1: … (Phase N)", …]`.
5. **Rebuild + commit** — `bash scripts/build-dashboard.sh`; commit both files (`docs(reviews): v{version}
   — remediation complete, verdict updated`). The dashboard always reflects current state (found, resolved,
   counts, verdict).
