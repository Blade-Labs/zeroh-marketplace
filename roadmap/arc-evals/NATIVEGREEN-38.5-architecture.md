# NATIVEGREEN 38.5 integration decision

Date: 2026-09-07
Verdict: `PROCEED_WITH_FIX`
Role execution: authorized native Sol fallback; exact runtime unverified. No Fable consultation is claimed.

## One production seam

Add `NativeAgentDriver` as the production role runner. It resolves the semantic role with
`resolveRole(roleId, parentDriverId, { policy })`, resolves the selected model's registered driver,
checks current-host capability provenance, builds one exact `RoleRunRequest`, and delegates durable
start/resume/await to the existing Claude or Codex adapter. Native type and model never replace
`roleId`; parent driver and policy are explicit inputs and are not inferred from the selected child.

Constructor inputs are `{ parentDriverId, policy, sessionId, parentAuthority, processTransports,
readLaunchInputs, provenanceStore }`. Production supplies registered process transports; tests inject
them. The production transport is the import-safe, driver-neutral extraction of the existing detached
`commands/codex.mjs` supervisor pattern: one supervisor owns exactly one registered native invocation,
has no retry or lifecycle transition authority, and publishes its bounded evidence in the sibling native-operation authority. The existing Codex command consumes the same supervisor helper; do not leave two process
ownership implementations. No adapter timeout or retry loop is added.

Before the supervisor acknowledges launch, it validates the canonical pending receipt plus exact
registry-owned argv/cwd/stdin bindings, starts exactly one child, and stamps the existing beacon with its
PID/process-group and run/executor/request/action/receipt identities. The beacon is liveness evidence,
not a new owner journal. The supervisor incrementally parses native JSON and, after child exit, publishes
one compact immutable completion artifact using the existing sidecar publisher. It retains only native
identity, one schema-bound phase-result candidate, terminal protocol record, exit/signal, byte counts,
and stream digests; combined native output is capped at 10 MiB and no transcript becomes lifecycle
storage. The supervisor does not mutate lifecycle receipts.

The canonical completion path is
`.building/native-operations/<encodeURIComponent(arcId)>/<encodeURIComponent(runId)>/<pendingReceiptDigest>/completion.json`.
Canonical bytes are `JSON.stringify(value, null, 2) + "\n"` over exactly `{version:1, arcId, runId,
pendingReceiptDigest, actionFingerprint, nativeSessionId, phaseResult, protocolTerminal, exitCode, signal,
stdoutBytes, stderrBytes, stdoutDigest, stderrDigest}`. The action fingerprint comes from the trusted
pending snapshot, never a caller string. The sibling storage owner reuses the RunReceipt ancestry,
realpath, containment, regular-file, canonical-byte, digest and no-symlink guards.

On restart, a matching live beacon PID/process-group is polled for the same operation; it never causes a
second launch. A readable completion lets the adapter bind its recorded native identity and atomically
persist the existing exited observation plus phase result. A pending receipt with neither valid live
beacon nor valid completion evidence is `unknown-native-outcome` HOLD. This includes supervisor death
after the external action but before completion publication: the outcome is unknowable and is not
retried. Conflicting, partial, corrupt, or wrong-revision evidence holds byte-intact.

## Provenance

Reuse the existing import-safe `commands/driver.mjs` report path, probe definitions, and exported
`freshProvenance` validation from `NativeAgentDriver`; do not copy its parser or create a second owner. A usable report has a parseable date whose age is `0 <= now - date <= 86_400_000` milliseconds, the current hostname,
at least one probe, every probe `pass: true`, and every command prefixed by the registered binary.
Require these named probes:

- Codex: `version`, `capabilities`, `exec-smoke`, `resume-smoke`, `model-pin`; help evidence must include
  JSON mode, output schema, exact-session resume, and the configured model.
- Claude: `version`, `capabilities`, `resume-smoke`; help evidence must include print/stream JSON,
  output schema, exact-session resume, model, restricted/tools/settings/permission mode, and strict MCP.

For a new external start/resume/action, missing or stale evidence triggers exactly one automatic call to
the existing safe verify owner (help/version probes only), then re-reads the report. Foreign-host, red,
wrong-binary, incomplete, or still-stale evidence returns a typed capability hold before source reads,
receipt persistence, arm creation, or process launch. The 24-hour rule is the new mechanical meaning of
"fresh"; future timestamps refuse. Ingesting an already-written identity/completion artifact does not
rerun provenance or become blocked because launch provenance later expired or the binary changed.
Registry `verifiedAt` is historical evidence and cannot satisfy a new external-action gate.

## Stable request and restart

On a restart, read the existing phase executor arm first. A native stable arm supplies the authoritative
`runId` and request fingerprint; use those to read the original immutable RunReceipt before reading
current HEAD, role-card, or governance inputs. Validate that stored request against the requested arc,
phase, semantic role, stable executor owner, and current parent-authority ceiling, then reconcile its
original operation evidence. Child commits may legitimately change HEAD and phase bytes, so recovery
must not derive a new run address from current checkout state. A legacy/partial arm cannot recover a
native run and holds. This is the existing arm's index, not a mutable pointer or global scan.

Only when no arm and no receipt exist, build a new request. Read the registered role card, obtain
governance through the existing `resolveGovernance` owner, capture exact base/requested HEAD, intersect
authority, and derive deterministic run/executor IDs from those canonical initial inputs. Complete
receipts return their persisted phase result. Pending receipts observe the exact supervisor operation;
resumable reducer states persist and launch one explicit resume. The native path never performs the
legacy blanket `liveArm` preflight or legacy arm/disarm writes.

## Preserve the phase-result owner

Native transport exit remains the reducer event `exited`; it is not phase success. Both registry
parsers must additionally extract exactly one structured `PhaseExecutionResult` candidate from the
schema-constrained final native response. Claude receives the contract via registry-owned
`--json-schema`. Codex receives an immutable per-run schema file via registry-owned `--output-schema`;
the file is created before the external action and its digest is part of governance bytes. Ambiguous,
missing, malformed, or oversized output holds/fails without inventing a result.

The adapter stores that candidate inside its existing atomic terminal receipt alongside transport exit
evidence and the reducer-normalized `exited` observation. It does not store the full native transcript.
`NativeAgentDriver` returns the persisted candidate as `{ result }`; on restart it reads the same
terminal receipt. `arc-plane.workflow` continues to send that value through the existing `roadmap
result check`, self-descope check, immutable result-consumption claim, verify-complete, shared mutation,
and result-tail completion beacon. Those remain the only owners of phase success.

## Workflow branch

Production default uses the native runner. An explicitly supplied `deps.agent` selects the legacy
fixture/harness branch, which retains its current `liveArm`, legacy `armExecutor`, watchdog result shape,
disarm, and result tail. The native branch skips legacy arm creation and disarm because the concrete
adapter owns the stable arm and receipt. It races one retained native-run promise against the existing
watchdog; a keep-waiting wake re-awaits that same promise. Both branches join at the unchanged
`spawn.result` / `roadmap result check` tail.

Inline band routing remains before either runner and is unchanged. Product-repository overlap checks
also remain before native start. No second scheduler, lifecycle reducer, result validator, result claim,
or recovery framework is added. The bounded supervisor extraction and provenance-owner extraction are
necessary scope additions to task 38.5: `cli/lib/native-process-transport.mjs`, its focused tests, and the existing import-safe provenance command owner used by `NativeAgentDriver`.

## Implementation review repairs

The native input digest is computed from the actual stdin bytes by code and persisted in the existing
pending operation before launch. The operation fingerprint includes that binding. Neither users nor
models predict hashes or retype a generated executable. Historical operations without the binding
remain readable but cannot initiate an external launch.

One exclusive operation directory prevents concurrent or repeated launch; an occupied directory with
unknown outcome holds. The existing beacon records supervisor PID/PGID and original receipt identity.
Its 30-second heartbeat must be no older than 90 seconds to establish liveness. This is a freshness
check, not a native execution deadline. The supervisor has no fixed execution cutoff.

The registry owns compact terminal projection and validation. The immutable completion stores an
untrusted structured phase-result candidate; the existing consumer `result check` remains the only
schema/phase-result validator before lifecycle success. A stored `transport-exited` record makes no
phase-success claim. Signaled exits preserve a null exit code and the actual signal.

Review: requested Sol architect (exact runtime unverified) identified missing stdin binding, stale
PID evidence, loose terminal metadata, and fabricated signal exit code. The fixes have independent
regressions. A separate launch-parent process exits before delayed fake-CLI completion; a fresh
observer retrieves the completion and verifies exactly one invocation. This is a local process test,
not a real model run or proof of native sandbox enforcement.

### Review verification

Verdict: `PROCEED_WITH_FIX` repairs verified. The pending operation now fingerprints the actual stdin
bytes and both parent and detached supervisor revalidate them. Live reconciliation requires a matching
beacon no older than 90 seconds. Registry-owned terminal validation rejects foreign terminal shapes,
and signaled completion preserves `exitCode: null` with its signal. The focused native transport suite
passes 10/10 according to the independent test run reported by the task owner.

No phase-success bypass was found. The compact artifact deliberately stores a plain-object/null
*untrusted candidate*; terminal persistence claims only `transport-exited`. Both fresh execution and
recovery return that candidate to the unchanged `roadmap result check --phase` call before descope,
result consumption, verification, shared mutation, or the phase-complete tail. Keeping that validator
as the single PhaseExecutionResult authority is the smaller and safer boundary; duplicating its TSX
schema inside the transport would create a second validation owner.

## Completed-run cleanup and workflow recovery

The normal native result tail now uses the existing result checker and consumer parser, original
request checkpoint, result-consumption claim, verify-complete, shared mutation, and terminal beacon.
Only after that terminal beacon does an exact arm reread permit the existing non-force disarm.
A crash after the beacon but before disarm is recovered by the same validator, using its normalized
accepted result digest (including schema defaults), the exact claim, and the exact terminal marker.
The terminal beacon carries the original arc and run identity so a later arc can clean up that
completed ownership without starting another executor.

An unfinished native result is consumed before `arc next` can advance from child-edited phase state.
Original acceptance metadata is read at the request's exact commit with `git show` and the existing
typed consumer bridge. Exclusive temporary sibling inputs preserve relative imports and are removed
in `finally`; unavailable original source or cleanup failure holds. There is no second metadata parser
or durable snapshot store. The existing legacy fixture path keeps its result-returned-before-disarm
ordering and joins the same consumption function.

A supplied watchdog races one retained native promise per phase. A keep-waiting wake cannot create a
second invocation. Durable completion polling runs once per second, reducing repeated receipt reads.
Malformed native output stops the owned CLI and closes the supervisor's own streams; broader process
group termination was rejected by automatic approval review and was not enabled.

## Full-gate root repair

The phase38 full gate at711d6f5 completed102 files and passed2355/2356 Node
checks in444.068 seconds. The sole failure was the existing active-root guard:
NativeAgentDriver collected governance from a hardcoded legacy phase path.
An independent production-factory regression retained the legacy layout and added
`docs/roadmap` with a phase-local AGENTS.md; it failed before launch with a
mismatched governance digest. The driver now resolves the phase target through
the existing roadmapRoot owner. Both layouts exercise real receipts, the detached
fake CLI, changed-HEAD recovery, and exactly one invocation. The focused root
and factory checks pass25/25. A fresh full gate and correctness review follow.
Raw full diagnosis: `.building/nativegreen-38-full-diagnosis.json`; raw focused
result: `.building/nativegreen-38-root-repair-green.log`. No live model execution
or broader migrated-workflow coverage is claimed by this regression.

## R1 authority disposition and repair

The independent reviewer reported fresh unsafe-parent refusal as HIGH and suggested
copying parent authorization. A single-hop architecture review ruled
`PROCEED_WITH_FIX`: the inability to inherit unsafe permission without a separate
child acknowledgement is intentional under the phase36 owner ruling. Copying
parent provenance would violate that boundary. Phase38 adds no unsafe API.
The concrete defect is the expected authority refusal throwing after capability
routing. Fresh runs now intersect the existing default inherit request first,
return an `authority-refusal` hold with the original reason on failure, and reuse
the derived envelope on success. No capability probes, receipt persistence, arm
claim, or launch occurs on this refusal. Historical recovery stays unchanged.
The architect was requested Sol via the previously authorized native fallback;
exact runtime is unverified, and no Fable execution is claimed.

Independent tests reproduced the throw (10 pass/1 fail). Affected driver checks
passed39/39, affected workflow checks7/7, and a final strengthened assertion
passed11/11 with explicit parent authorization but no child acknowledgement.
The recovery unit check proves adapter routing without fresh provenance or a
start/resume; the separate real-store factory and workflow suites cover durable
recovery. Raw results are `.building/nativegreen-38-authority-repair-green.log`,
`.building/nativegreen-38-authority-harness-green.log`, and
`.building/nativegreen-38-explicit-parent-green.log`.
The full gate000017 at41198b4 passed2357/2357 across102 files plus schema in469.701
seconds before this narrow review repair. These focused checks are its subsequent
repair evidence; no second full run is claimed for the repaired source.
