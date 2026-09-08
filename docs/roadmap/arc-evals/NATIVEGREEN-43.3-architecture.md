# NATIVEGREEN 43.3: scoring contract

Decision: **PROCEED_WITH_FIX**. Reuse canonical run, delivery, correction, normalization,
cleanup and evaluation owners. The scorer is a read-only evaluator; it creates no runtime
journal or native execution. Architect request: `gpt-5.6-sol`, runtime identity unverified.
The supervising session resolved incompatible draft signatures against the actual owners;
the final interfaces below supersede those drafts.

## Public interfaces

- `scoreDeterministicSentinels({contract,index,armId},ports)` returns
  `{armId,status,absoluteScore,sentinels}`. Each sentinel has `name,status,ownerRefs,evidence,reason`.
  All eleven named sentinels must pass. `absoluteScore:1` denotes deterministic validity,
  never outcome quality; missing/unreadable/failed evidence produces `null`.
- `buildBlindJudgePacket({contract,scenarioId,armScore},{readAnonymizedDeliverables})` returns
  a deeply frozen `{version,packetId,criteria,deliverables,deterministic}`. Packet IDs are
  opaque ordinals of the fixed matrix. Criteria use the scorer's fixed per-criterion expected
  behavior; there is no model-predicted hash. Deliverables contain only
  `{artifactId,mediaType,content}`. Reject identity/condition/model/plugin/reasoning leaks.
- `mergeBlindVerdict({packet,expectedJudge,judgeEvidence,verdict})` preserves
  judged/abstained/unjudged/invalid separately. `expectedJudge` is `{driverId,modelId,runId}`.
  `judgeEvidence` is `{pendingReceipt,terminalReceipt,stdin}`. UTF-8 stdin bytes must parse to
  exactly the packet and match the existing pending operation's inputDigest. The canonical
  terminal must retain the same request, a later revision and exact observed model/session.
  No invented `RoleRunRequest.taskInput` field. Judge preparation/native attestation belongs
  to43.4; these injected reader tests do not establish a real judge run.
- `pairGauntletOutcomes({contract,plugin,baseline})` accepts rows
  `{armId,scenarioId,conditionId,fixtureSha,score,judgment,packet}`. Compare only reciprocal
  frozen mates, same fixture/scenario and actual judge model, with every criterion judged.
  Missing/abstained/invalid evidence is incomplete, confidence null. Valid comparisons use
  met-criterion counts and the minimum reported criterion confidence. No historical means.

## Reader ports

All scorer ports are synchronous, read-only, and return actual records/raw observations.
Canonical absence is null; parse/I/O failures throw and remain unreadable. The43.5 collector
owns retaining invocation outputs, not a new proof journal. Existing run history is readable
through `readRunReceipt(cwd,address,{digest|revision|actionFingerprint})`.

```text
readRunReceipt(cwd,address,options?) -> canonical {path,digest,snapshot} or null
loadArcDelivery(cwd,ownerArcId) -> canonical ArcDelivery or null
git(root,argv) -> stdout string; nonzero/error throws

readLifecycleCases({armId,scenarioId}) ->
 {schemaVersion:1,armId,scenarioId,arcs:[{arcId,cases:[{criterion,invocationId,output}]}]}
readResumeObservations({armId,scenarioId}) ->
 {schemaVersion:1,armId,scenarioId,arcs:[{arcId,first,second}]}
 first/second = {invocationId,runAddress,runReceipt,delivery}
readNormalizationObservation({armId,scenarioId}) -> {arcs:[{arcId,plan,receipt}]}
readCleanupObservation({armId,scenarioId}) ->
 {cases:[{identity,worktree,result,after:{exists,headSha,recoverableHeadSha,branchRefSha}}]}
readEvaluationObservation({root,arcId}) -> {summary}
```

Every lifecycle/resume/evaluation set covers all three frozen arcs. Grouped members resolve
to the first arc's existing delivery owner; normalization is per delivery owner. First resume
run snapshots are checked against canonical historical digests; second snapshots must match
latest records. Stable run/request/session/result, target/head/PR and action/attempt contents
must remain unchanged; revisions may increase. No replay is authorized by scoring.

The normalization observation pairs an ordinary retained pre-publication plan with its
ordinary receipt, never with a published-correction receipt. Verify actual Git trees, six
outcome mappings, parent chain, rescue ref and current ancestry. Do not call the planner again
on a published head. Published CI correction provenance is separate from this ordinary
normalization observation; a green-PR cosmetic rewrite cannot masquerade as ordinary work.

All50 cleanup cases must retain unique worktree identities. Derive each result through
`worktreeCleanupOutcome`; removed cases need matching ownership, inactive/clean/recoverable
observations and preserved head/branch recovery. Held cases must remain present. Requiring
all50 to be removed would be unsafe. Evaluation readers load the persisted summary and use
`assertCurrentDeliverySummary`; scoring also applies `assertDeliverySummary` to the currently
loaded owner. Returning a precomputed `passed:true` is forbidden.

## Lifecycle predicates

- blocked/stalled/unobserved/exited/review-exhausted/auth use the actual `buildHaltPayload`
  output, including typed halt, phase, raw evidence and canonical resume line. An unobserved
  pending native operation is not invented as a successful or active reconciliation.
- quota/timeout use canonical ExactHeadCiResult held observations and their exact hold kinds.
- causal/owned-preexisting/unrelated/infrastructure/flaky/indeterminate use complete
  `classifyFailureScope` outputs. Only the first two permit edit paths. Actual correction
  Git changes must remain within the recorded scope; residual failures cannot be edited.
- both validation routes use the actual `routeDeliveryCorrection` result and checkpoint
  binding, fixed round/deadline/source/input/scope bounds, with the matching route trace.
- repeated-input retains `retryDecision` output with blocked failures/signatures.
- normalization/GC/current-green/evaluation/second-resume case outputs must equal their
  dedicated canonical observations; prose assertions or caller scores are not substitutes.

## Verification boundary

Tests inject raw owner observations and Git answers to exercise valid evidence and targeted
mutations. This establishes scorer behavior only. Native processes, observed model identities,
sealed artifact collection and real provider actions require43.4–43.5. Expected judge identity
is explicit input here; no frozen native judge selection or successful native trial is claimed.
