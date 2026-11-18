# NATIVEGREEN 43.4 — historical broad-scope preparation

Superseded by the owner’s2026-09-08 single-pilot ruling. This record describes earlier preparation, not active requirements or current run status. The uncommitted matrix-preflight extension below was archived and removed from the candidate; its tests are historical evidence only. Current scope and results are in `NATIVEGREEN-codex-usability-reassessment.md`. Task43.4 remains incomplete.

## Verified local change

Detached start, resume and recovery preserve the native transport terminal payload. The durable result now retains raw usage and optional protocol subtype/error. Missing usage stays null; requested model is never copied into observed model identity. Legacy string terminal payloads remain readable.

Configured task unit gate: run-000015-2026-09-08T08-28-08-844Z.json — 52 passed, one explicit host-only skip, three files, 11.247 seconds. Types run-000016-2026-09-08T08-29-47-367Z.json: declared-none. These are partial task checks, not a phase gate or live attestation. Read-only independent seam review found no concrete regressions. Requested reviewer model follows codex-full; actual model identity unverified.

The initial three RED tests used a completion shape the canonical transport does not emit; that RED is invalid evidence. Corrected canonical cases pass after the fix. Do not claim a valid canonical test-first sequence.

## Remaining implementation

Reuse preflight, native transport, run receipt and delivery owners. No new scheduler or execution journal. Preflight observations must bind the frozen index and current dispatch, recompute hashes from actual bytes, and be checked again before launch. A preflight ready result is not evidence of an executed parent/child or provider action.

Native process metadata must distinguish command wrappers from observed runtime executables, version completion additions explicitly, preserve legacy completions as readable but unattested, and retain actual timestamps/usage. Child execution must resolve to a real child receipt matching the frozen driver/model and parent link, never parent prose. Native/provider output must not be promoted solely from injected test adapters.

## Live boundary

Pending owner input: total native runtime, total tokens, and per-arm timeout for the frozen 24-arm comparison. Installed Codex help has no preemptive token-limit flag. Observed accounting can fail an overrun and prevent later starts, but cannot promise an exact token ceiling on an already running turn. Isolated provider authority and credentials must also be verified before any live action.

## Additional offline preparation

Implemented createPreflightReceipt and verifyPreflightReceipt in the existing preflight owner. They reuse the exported existing arm-index validator, bind all prepared namespaces, reread current binary/manifest bytes, normalize unordered probe results, and reject expiry, copied identity, timestamp contradictions, byte changes and missing current dependencies. They return in-memory prerequisites only; production dispatch integration and live attestation remain unfinished. Hashing observed files does not authenticate vendor binaries or establish installed plugin runtime loading.

Independent review identified a pathname-check/read race; fixed with one held descriptor, bounded read, metadata and final path checks. Root review identified FIFO blocking; O_NONBLOCK and an actual FIFO test under a child timeout address it. Re-review of the race fix is clean. No timing-race mutation coverage is claimed.

Final configured task unit gate: run-000020-2026-09-08T08-46-04-128Z.json — 55 passed, one host-only skip, three files, 11.410 seconds. The preceding run-000019 failed because the FIFO test used a cwd-relative import; the import now resolves from import.meta.url and the configured gate passes. New preflight tests were added after production appeared; do not claim a canonical RED-before-implementation sequence. Task43.4 remains not done; its changes remain uncommitted for its single completion commit.
