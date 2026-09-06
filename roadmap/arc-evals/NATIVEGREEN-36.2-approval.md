# NATIVEGREEN task 36.2: approved reusable launcher authority

Status: owner approved the proposed launcher security change on 2026-09-06: “ok agreed, but make sure it has all necessary pwrmissions so it wont bother me many times”. Reuse this authorization for routine implementation, testing and required local Git commits; native automatic approval review mediates exceptions. The earlier automatic-review rejection preceded this explicit approval. Task36.1 is committed at43b48db with136 passing scoped checks. Task 36.2 implementation and parent review are complete; its combined capbuild task gate passed on 2026-09-06 (run-000008, 53.6 seconds). Native runtime confirmation remains pending.

## Current behavior and proposed replacement

`plugins/zeroh-roadmap/cli/lib/drivers.mjs` currently launches every Codex lane with `--dangerously-bypass-approvals-and-sandbox`. Replace that unconditional bypass with one authority reducer and the existing launcher/registry:

- Explicit `--parent-authority read-only|workspace-write|isolated-unsafe` records the invoking operator context. `--authority` defaults to inherit and can only narrow the recorded parent. Unknown parent/profile or enlargement refuses before worktree/prompt/journal/spawn. Repository config, environment, prompt and old journal do not grant authority.
- Normal read-only/workspace-write launches select that native sandbox, disable command network access and additional writable roots, and retain native approval mediation. Use `approval_policy="on-request"` and `approvals_reviewer="auto_review"`, after verifying supported controls. Do not use approval never: protected Git metadata would prevent required commits.
- Only a recorded isolated-unsafe parent plus a separately supplied `--authorize-isolated-unsafe` acknowledgement permits the existing unsafe posture. It is never the default or an automatic recovery path.
- Preserve parent/request/effective/provenance/native evidence, with exact registry-owned argv recorded before spawning. Export matching AuthorityEnvelopeShape in both schema homes. No new authority service, scheduler, or cryptographic attestation system.

Normal proposed argv, with model/worktree supplied by the existing registry/caller:

```text
codex exec --ignore-user-config --sandbox workspace-write
  -c approval_policy="on-request"
  -c approvals_reviewer="auto_review"
  -c sandbox_workspace_write.network_access=false
  -c sandbox_workspace_write.writable_roots=[]
  -m <registry-model> -C <worktree> -
```

The read-only profile substitutes its native sandbox. Argument arrays, not shell transcription, carry these values. Native support/precedence failures hold; they do not trigger bypass.

## Practical limits and verification

Native approval review may approve a required local Git commit or refuse an action; workspace-write is therefore not an absolute no-exceptions guarantee. Command-network controls do not globally constrain apps/MCP/web. gitPush/externalWrites remain explicit semantic constraints, not a claimed dedicated native enforcement mechanism. Explicit operator input records delegation; it does not attest OS policy or authenticate the operator cryptographically. Actual runtime isolation remains unverified until native tests run.

Independent tests cover inheritance/narrowing, all bound enlargements, unknown parent, separate unsafe acknowledgement, immutable inputs, schema parity, numeric option parsing, all three launch lanes, and actual fake-child argv matching the receipt. Their earlier approval-never expectation is superseded by the approval-mediated proposal. The approved production change passed its combined task gate. No live native model trial has run for task 36.2.

Official native behavior: [Agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security) documents protected Git metadata and automatic approval review. [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) defines the native settings and network-control limits.

## Approval boundary

Automatic review rejected the edit because it changes persistent sandbox/approval semantics and retains an unrestricted unsafe path; it requires explicit user approval of that change and its blast radius. The change affects every Roadmap Codex run/plan/review launch. The unsafe path already exists unconditionally; the proposal makes it explicit and conditional, but its residual risk remains unrestricted execution when deliberately selected.

The earlier rejected mutation was held until the owner explicitly approved it; implementation resumed after that approval. A separate external Claude architecture consultation was also rejected before execution; the documented native Sol fallback supplied the final design ruling. Exact fallback runtime is unverified; no Fable review is claimed.
