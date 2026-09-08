# Native core migration and review

Roadmap **0.41.0** retains **22 production source files** (14 runtime modules/adapters, three maintenance/scaffolding scripts and five typed templates), down from 91. Greenfield **2.0.0** retains **one optional helper**, down from four code files. Tests, Markdown, manifests and history are outside these source counts. These are candidate versions, not a release announcement.

The native session now owns workers, independent review, tests, rolling planning and Git. The retained CLI owns status, reservations/ownership, init and typed validation. Greenfield supplies a PRD interview and selected project recipes without a required Roadmap engine. The change removes orchestration responsibilities rather than moving them into the validator.

## Before updating a consumer

Inventory its scripts, skills and automation calling removed commands. Keep that consumer on its compatible plugin version until the callers are explicitly adapted to native tools and the supported CLI. Do not automatically update caches or overwrite consumer files, configuration, workflows, archives or vendored schemas.

Read explicit legacy design/test/validation/merge policy as guidance; malformed or unknown policy grants no authority. Active legacy arcs need a legitimate approved-intent reference. If their schema strips or rejects that metadata, review a focused opt-in schema extension first, preserving the existing record meaning. Merely adding an unknown field does not make it survive parsing.

Strict validation reads both the current committed HEAD record and the approved baseline. Both must use supported literal declarative arc data; computed spreads and imported helper values are rejected rather than evaluated from the mutable working tree. Preserve the recorded full commit/path reference and append-only legitimate owner ratifications. An unreadable committed record is a blocker, not an absent baseline. The validator checks recorded consistency; it cannot authenticate consent or prove the product works.

Install the package's declared dependencies or the consumer's corresponding tooling: `tsx` and `zod` for typed loading, and `typescript` for literal intent parsing. Missing tooling is unavailable, never green. Run strict `roadmap phase validate <path>` before queueing and completion on both hosts; fail-soft hooks are supplemental diagnostics.

## Bounded native observations

The Codex observation took approximately 378 seconds including independent review and window replenishment. A real local bookmark phase implemented persistent add/list behavior; its independent reviewer ran two tests and separate HTTP/HTTPS add/list processes. A failed README assumption led to an in-scope documentation phase. The replenished window had two pending phases and two explicitly deferred criteria; independent plan review and strict arc/phase validation passed.

The first Claude attempt took 526 seconds and encountered an allowlist limitation; its static review did not establish runtime acceptance. The single corrective attempt took approximately 195 seconds. A native independent agent actually ran seven tests and the CLI journey using the host's admission wrapper. Fresh initialization, strict validation by file and phase number, status and emitted progress passed; the reviewed fixture HEAD was `3247b04`.

Both observations deliberately ended with arcs still in progress, two pending phases and two deferred criteria. They establish bounded native phase execution and rolling continuation, **not whole-arc completion**, platform-matrix support, a performance improvement or superiority to another framework. No raw session transcripts or credentials are part of this review note. Required CI and outstanding review findings still govern merge/release readiness.
