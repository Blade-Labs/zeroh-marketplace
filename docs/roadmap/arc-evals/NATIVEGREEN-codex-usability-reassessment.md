# NATIVEGREEN: one Codex usability pilot

Owner ratification, 2026-09-08: “yes, I want one real Codex end to end run, necessary fixes and review.” This supersedes the full-arc resumption. Task43.4 is the only active release work;43.5–43.8 and phases44–45 remain deferred and not done. Completed36–42 and43.1–43.3 are preserved.

## Release bar

Use one installed candidate in an isolated ordinary consumer. A real Codex session must produce runnable tested output, bounded independent review, one non-draft open PR whose required checks pass on the current head, and a resume without duplicate executor/PR creation. No session-authored workflow driver or predicted hashes. The existing CLI/session handoff is the entrypoint.

Reuse the previously ratified 20-minute native-runtime ceiling, shared capbuild admission, one targeted correction and one independent review. A HIGH repair gets one bounded re-review. Preserve incomplete work on timeout, unknown executor state, missing authority, repeated failure or material gaps. Known token usage and unknown usage remain separate; the native CLI has no hard token ceiling. Merge stays manual. One observation supports only the exercised Codex path.

Keep necessary repairs and already shipped0.40.4/0.40.5 fixes. The uncommitted matrix-preflight extension has been saved to `.building/nativegreen-deferred/43.4-matrix-preflight.patch` and removed from this candidate; native usage preservation remains active. Original broad task text remains in the phase and Git.

## Consumer feedback, requested through Herdr

Read-only requests sent to existing ZeroH Codex (wY:p1), Viky supervisor (w2:p1), and Atlas supervisor (w8:p1). They were asked to use existing observations only, preserve their current work, and avoid tests or model runs. These reports are inputs, not fresh acceptance evidence.

| Consumer | Report and verification | Disposition |
|---|---|---|
| ZeroH | Session read cache0.40.3 after stale catalog0.39.1 path failed. Native collaboration reviews worked; the session did not execute a Roadmap arc. Broken bwrap RTM_NEWADDR required shell escalations. | Stale-session/cache guidance and host issue; do not claim a Codex end-to-end success. |
| Viky | Claude supervisor reports native Codex builders/review/plan lanes and real journals. Append-only guard phantom comment element was fixed in7186476 (0.40.4); Astra alias supplied by95255dd (0.40.5). Kotlin task tests expanded to npm tests; fresh review worktrees lacked node_modules. Xvfb reaping and login failures were host/auth issues. | Carry shipped fixes. Check custom test mapping and review bootstrap; fix only reproduced release blockers. Native Codex child usage is corroborating evidence, not a Codex-parent pilot. |
| Atlas | Claude supervisor used a scratch plane driver; phase84 itself executed on Claude. Codex was used directly for architecture/review. Real84-executor.jsonl contains17 `at` records and8 canonical `ts` records; reader produces NaN for `at`. Contract schema script imports zod from consumer eval cwd rather than the schema dependency home. | Candidate already has maintained CLI plane entry. Repair timestamp refusal/compatibility and schema-local dependency resolution. Consumer schema migration remains separate from changing parser expectations. |

Atlas’s current push403 is a GitHub App permission issue, not Roadmap failure. Viky’s four-round design reviews found real problems; do not remove required review because the round count is high. Both reports describe foreign/supervisor commits blocking cosmetic curation; preserve those commits.

## Current checkpoint

Candidate01208e1 predates primary0.40.5; carry the known shipped fixes before the pilot. Task43.4 is in progress. Native usage repair has focused regression coverage. No single-pilot native session or new PR has launched yet. Full-arc completion, broad parity and performance improvement remain unclaimed.
