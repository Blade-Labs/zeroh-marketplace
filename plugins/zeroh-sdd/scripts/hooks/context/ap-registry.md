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
