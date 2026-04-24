# Anti-Pattern Registry

Detection patterns for the `ap-detector.sh` PostToolUse hook.
Add rows to detect new anti-patterns. The hook reads this table at runtime.

## Tier 1: Grep-Catchable (any file, <100ms)

| id | pattern | file_filter | message | remediation |
|----|---------|-------------|---------|-------------|
| AP-ERR-01 | `return (null\|undefined\|\[\])` inside catch block | *.ts,*.tsx | Error swallowing — catch block returns null/undefined/[] | Use canonical error utility or re-throw with enrichment. Errors are the debugging interface. |
| AP-ERR-02 | `function (handle\w*Error\|.*[Ff]allback\|create.*Error)` | *.ts,*.tsx | New error handler bypassing canonical utility | Use the project's existing error utility. Don't create parallel error handling. |
| AP-ANY-01 | `as any` or `as unknown as` (count > 3 per file) | *.ts,*.tsx | High type assertion density | Fix types properly. Each `as any` hides a potential runtime failure. |
| AP-DOC-01 | `--no-verify` or `--no-gpg-sign` | * | Commit hook bypass detected | Never skip hooks. Fix the underlying issue that makes the hook fail. |
| AP-FAT-01 | Route handler function body > 50 lines | *route*.ts,*handler*.ts | Fat route handler — business logic inline | Extract to service layer. Route handlers should validate input + call service + return response. |
| AP-IGN-01 | `@ts-ignore` or `biome-ignore` without explanation | *.ts,*.tsx | Suppression without justification | Fix the underlying issue or add a comment explaining why suppression is necessary. |
| AP-ENV-01 | `process.env.` outside config/ or env/ directories | *.ts,*.tsx | Scattered environment variable access | Centralize env reads in a config module. Scattered reads create invisible coupling. |
| AP-LOG-01 | `console.log` in non-test file | *.ts,*.tsx | Console.log left in production code | Remove or replace with structured logging. |

## Tier 1: Closed-World Admission (*.ts, *.tsx, *.sparql)

Derived from Blade-Labs/grc-zod-alpha-audit Phase B signal-absorption manifest (2026-04-24). These codes cover the four distinctive CWA-violation patterns that the repo-scoped cwa-fallback-detector previously caught; they now live in the plugin as the single source of truth.

| id | pattern | file_filter | message | remediation |
|----|---------|-------------|---------|-------------|
| AP-CWA-01 | `??` with non-boolean operand (excluding `?? false\|true\|null\|undefined`) | *.ts,*.tsx | Silent default masks missing value — CWA violation | Replace with explicit undefined handling or throw. Nullish-coalescing with a non-boolean RHS hides the "value is missing" signal. |
| AP-CWA-02 | Empty or comment-only catch block: `catch () {}` / `catch (e) {}` with no throw/return/log | *.ts,*.tsx | Swallowed error — catch has no re-throw, log, or typed-error return | Re-throw with context or return a typed error object. Empty catch erases diagnostic signal. |
| AP-CWA-03 | `model\|provider\|fallback` arrays containing provider names (`claude\|gpt\|opus\|sonnet\|haiku\|openai\|anthropic\|local`) | *.ts,*.tsx,*.json | Fallback model/provider chain detected — CWA forbids silent provider substitution | Remove the fallback array. Primary model must fail closed. The LLM router is the sole routing point. |
| AP-CWA-04 | `SELECT \?s \?p \?o` wildcard SPARQL read | *.ts,*.sparql | Wildcard read admits unchecked statements — provenance bypass | Narrow the query to a specific predicate + graph. Wildcard reads are forbidden under CWA. |

## Tier 1: Hardcoded Ontology Data (*.ts, *.tsx — multi-line awk)

Derived from Blade-Labs/grc-zod-alpha-audit Phase B signal-absorption manifest (2026-04-24). Unlike the other tiers, this requires multi-line awk analysis (const-block body scanning), not single-line grep.

| id | pattern | file_filter | message | remediation |
|----|---------|-------------|---------|-------------|
| AP-HARD-01 | const block containing ≥ 2 CURIE/URN/IRI string values (e.g. `"dpv:Foo"`, `"urn:grc:..."`, `"https://..."`) | *.ts,*.tsx | Hardcoded ontology data — should load from bundle, not inline as TS constants | Replace the const with a bundle loader call (e.g. `@grc/bundle` resolver). Ontology is data; duplicating it in code creates drift. |

## Tier 1: Shape-Specific (*.shape.ts only)

| id | pattern | file_filter | message | remediation |
|----|---------|-------------|---------|-------------|
| AP-SHAPE-01 | Has `status` or `state` or `currentState` field but no `discriminatedUnion` | *.shape.ts | State field without discriminatedUnion — each status should have per-state required fields | Use `z.discriminatedUnion('status', [...])` instead of z.object + enum. |
| AP-SHAPE-02 | Has 2+ `datetime()` calls but no `.refine` | *.shape.ts | Multiple dates without temporal ordering validation | Add `.refine(d => new Date(d.updatedAt) >= new Date(d.createdAt), ...)` for date ordering. |
| AP-SHAPE-03 | No `.meta(` call in file | *.shape.ts | Shape missing .meta() semantic metadata | Add `.meta({ id, prefLabel, version, category, definition })` — minimum Operational tier. Use `deriveIdentity()` for id/prefLabel. |

## Tier 1: Wiring (any .ts file)

| id | pattern | file_filter | message | remediation |
|----|---------|-------------|---------|-------------|
| AP-WIRE-01 | Imports `*Schema` from shapes path but no `safeParse`/`.parse(`/`validatedParse` in file | *.ts | Shape imported but never used for validation — shape is documentation, not enforcement | Add `Schema.safeParse(data)` or `validatedParse(Schema, data, { route })` at the boundary. |
| AP-WIRE-02 | `response.json() as T` type assertion | *.ts | Unvalidated type assertion bypasses shape enforcement | Replace with `validatedParse(ResponseSchema, await response.json(), { route })`. |
| AP-WIRE-03 | `throw new Error(await response.text())` | *.ts | Error chain destruction — stringifies structured error into plain text | Use `throwUpstreamError(response)` or parse the response as RFC 9457 first. |
| AP-WIRE-04 | catch block without remediation keywords (remediation, fix, check, run, verify) | *.ts | Error without remediation is unactionable by LLM | Add specific remediation: what endpoint to check, what config to verify, what command to run. |
| AP-WIRE-05 | `.parse(`/`safeParse(`/`validatedParse(` called but no `*Schema`/`*Shape` import in file | *.ts | Parse call without declared shape — boundary validation bypassed | Add `import { FooSchema } from '...'; FooSchema.safeParse(data)` at the boundary. Inverse of AP-WIRE-01. |

## Tier 1: Test-Specific (*.test.*, *.spec.*)

| id | pattern | file_filter | message | remediation |
|----|---------|-------------|---------|-------------|
| AP-TEST-01 | Test file with no `@covers` or `@spec` annotation | *.test.*,*.spec.* | Test without acceptance criteria traceability | Add `@covers AC-US1-1` or `@spec Cl.3.1` linking each test to the requirement it verifies. |

## Tier 2: Diff-Catchable (test files only, <200ms)

| id | pattern | file_filter | message | remediation |
|----|---------|-------------|---------|-------------|
| AP-CAP-01 | Diff shows `-toThrow` and `+toBeUndefined` or `+toBeTruthy` | *.test.*,*.spec.* | Test assertion weakened — toThrow() changed to weaker assertion | Fix the code to match the test, not the test to match broken code. This is test capitulation. |
| AP-CAP-02 | Diff shows `it(` or `test(` count decreased, or `+it.skip`/`+xit`/`+xtest` added | *.test.*,*.spec.* | Test removed or skipped | Scaffold integrity violated. Tests derived from acceptance criteria must not be deleted. |
| AP-CAP-03 | Diff shows `-severity: 'error'` and `+severity: 'warn'` | *.gate.*,*.fitness.* | Gate severity downgraded | Fix the code that fails the gate. Downgrading severity hides the violation. |
