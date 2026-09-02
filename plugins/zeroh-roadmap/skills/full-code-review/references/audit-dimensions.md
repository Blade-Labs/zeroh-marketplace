# The Eight Audit Dimensions

One agent per dimension (subagent type `code-reviewer`). Each mission below is
a charter plus its repo-specific sources — the agent derives the concrete
checklist from the consumer, never from another project's residue. Every agent
also gets the shared preamble from SKILL.md Phase 2 (read + trace, finding
format, 80% confidence bar) and the consumer's `reviewFocus` classes from
`<root>/roadmap.config.json`, which prepend and outrank everything here.

## 1. Security & auth

Audit every auth route, middleware, session/token handler, and input boundary
for bypass, authorization gaps, injection/XSS vectors, secret exposure, and
missing rate limiting or validation.
Sources: the consumer's CLAUDE.md security rules; prior security findings in
`reviews/*.md` and `reviews/releases/v*-review.json` — recheck each previously
fixed item and label any reappearance `Regression: yes`. Secrets in configs:
inspect narrowly, never dump whole env/app-setting blobs into the finding.

## 2. Dead code & dead references

Find unused exports, unreachable branches, stale references to renamed code,
deprecated re-export shims, and unused package.json dependencies.
Key heuristic: an orphaned module is one whose only importers are tests —
trace the import graph from production entry points and require at least one
PRODUCTION import per export before counting it live. Your dead-code list
feeds the consolidation cross-drop (a bug in dead code is not a live defect),
so anchor each item precisely.

## 3. Duplication

Find copy-pasted or near-identical logic where one shared implementation would
genuinely improve maintainability — especially weaker local copies of an
existing shared utility (diff the copies; the divergence is usually the bug)
and duplicated security/validation logic that must not drift apart.
For each finding name the specific shared home (existing module or proposed
one). Skip duplication that an abstraction would not actually improve.

## 4. Performance

Find issues with measurable user or resource impact: algorithmic inefficiency,
N+1 data access, missing caching/memoization where inputs repeat, unreleased
listeners/subscriptions, CPU-bound work holding scarce resources (connections,
transactions), oversized eager imports.
Sources: the framework and data layer identified in the Phase 1 summary — check
the consumer's idiomatic data path (its query/cache layer) and flag code that
bypasses it. Skip micro-optimizations.

## 5. Architecture & project conventions

Judge against the consumer's OWN rules, not generic defaults: CLAUDE.md
conventions, layering/dependency direction, declared purity or
dependency-injection rules, type-safety discipline (unvalidated casts, `any` at
boundaries), single-source-of-truth for constants and config.
Cite the violated CLAUDE.md rule or `reviewFocus` class in each finding rather
than paraphrasing it. Where the consumer documents an architecture
(`docs/`), contradictions between doc and code are findings too.

## 6. Edge cases & latent bugs

Trace failure paths: unhandled null/undefined, missing error handling around
external calls, race conditions and stale closures in async code, off-by-one
in pagination/slicing, partial-failure states.
Three patterns worth explicit tracing in any repo with persistence: multi-step
writes that are not atomic (step 2 fails, step 1 committed); records persisted
before a subsequent fallible step (orphaned rows when it fails); and
stricter parsing/validation introduced over state persisted by earlier code —
a schema tightened after records were written throws at load time, so check
what the store actually holds, not what current writers produce.
For every finding describe the concrete triggering scenario.

## 7. Data flow & integration integrity

Follow data from external inputs (API, user input, env, files, DB) through
transforms to outputs. Verify: type/contract consistency across module
boundaries, complete error propagation (no swallowed errors), caller/callee
request-response shape agreement, third-party failure modes handled.
Env-var audit: every variable the code reads must be set in the deploy
config the consumer actually uses (find it in Phase 1 — CI workflow env blocks,
infra templates); flag referenced-but-unconfigured vars.

## 8. Domain-critical correctness

Verify the calculations and invariants the consumer's domain cannot get wrong.
Derive WHAT those are from CLAUDE.md and the domain docs found in Phase 1 (for
a financial platform: integer-unit money math and balancing invariants; for a
governance platform: masking/audit invariants; etc.), then verify every
computation site uses the same inputs and the same canonical utilities — 
divergent computation paths for the same value are findings even when each
path looks locally correct. Exact assertions over approximate ones in the
domain's tests are part of this dimension.
