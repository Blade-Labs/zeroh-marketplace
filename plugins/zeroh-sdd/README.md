# zeroh-sdd

Shape-Driven Development runtime for Claude Code.

`zeroh-sdd` turns Spec Kit-style planning into an executable loop enforced by Claude hooks:

```text
execution-spec -> active-stage.json -> hooks enforce boundary -> proof command -> receipt -> doctor -> next slice
```

This is the v1 clean runtime. There are no legacy Speckit shims.

## Install

```text
/plugin marketplace add Blade-Labs/zeroh-marketplace
/plugin install zeroh-sdd@zeroh-marketplace
```

Runtime prerequisite: Node.js 18.18 or newer.

## Commands

The plugin ships a self-contained CLI:

```bash
zeroh-sdd check --plan <path>
zeroh-sdd doctor --plan <path>
zeroh-sdd stage set|status|finish|clear
zeroh-sdd jit --file <path>
zeroh-sdd self-test
```

The Claude hooks call the same runtime through a small launcher that finds `node` or `node.exe`:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-sdd" hook <event>
```

## State Files

Project state lives in the consuming repo:

- `.specify/workflows/active-stage.json`
- `.specify/workflows/hook-state.json`

Plugin cache lives in Claude plugin data:

- `${CLAUDE_PLUGIN_DATA}/shape-registry.json`
- `${CLAUDE_PLUGIN_DATA}/runtime-cache.json`

If `CLAUDE_PLUGIN_DATA` is unavailable, local CLI runs fall back to `.specify/workflows/.zeroh-sdd-plugin-data`.

## Skills

| Skill | Purpose |
| --- | --- |
| `specify` | Capture intent, evidence, owner, non-goals, and acceptance signals |
| `clarify` | Resolve only ambiguity that changes the next executable proof gate |
| `plan` | Frame the current slice and hand off to `execution-spec` |
| `execution-spec` | Author the fenced `sdd` block and stage gate |
| `shapes` | Author Zod shapes as executable acceptance criteria |
| `tasks` | Break the active stage into proof-preserving tasks |
| `implement` | Execute inside the active stage boundary |
| `analyze` | Audit plan, stage, implementation, APs, and receipts |
| `sdd-readiness` | Run `check` and `doctor` before implementation |
| `ap-taxonomy` | Shared AP vocabulary and hook envelope contract |

## SDD Block

Every actionable execution spec carries exactly one fenced `sdd` YAML block:

```sdd
sdd:
  version: 1
  id: example-step-1
  status: ready
  requirement:
    owner: "named owner"
    evidence:
      - "source input"
    why_now: "why this proof gate is next"
  change:
    intent: "what changes"
    adds: []
    deletes_or_subsumes: []
  source_authority:
    official_sources: []
    local_extensions: []
    prohibited_shortcuts: []
  simplification_proof:
    preserves:
      - "validation"
    rejected_simpler_options: []
  validation:
    commands:
      - "runnable proof command"
    proof_tiers:
      - "unit"
  stage_gate:
    next_gate: "receipt for this step"
    first_executable_slice: "smallest proof-producing edit"
    proof_command: "runnable proof command"
    stop_rule: "when to stop"
    replan_trigger: "when to replan"
    surfaces:
      existing: []
      creates: []
      future: []
  shape_gate:
    required_shapes: []
    parse_boundaries: []
    status: red
```

## Stage Loop

Set the active stage before implementation:

```bash
zeroh-sdd stage set \
  --stage "Step 1 - boundary proof" \
  --step-id "Step 1" \
  --plan "docs/build-log/example-execution-spec.md" \
  --allow exact:src/route.ts \
  --proof-command "pnpm test" \
  --stop-rule "Stop after receipt."
```

Hooks then enforce the stage:

- writes outside `allowedPaths` are denied
- commit, push, merge, and new stage setup are denied while the stage is open
- Stop and TaskCompleted are blocked until `stage finish` closes the receipt
- proof command completion triggers a receipt reminder
- AP findings stay advisory, and deterministic JIT checks run async by default

Finish the stage only after proof:

```bash
zeroh-sdd stage finish --status passed \
  --proof-result "pnpm test => pass" \
  --changed "src/route.ts" \
  --closed "SDD041" \
  --next-adjustment "Proceed to Step 2."
```

`stage finish` appends an execution receipt, runs `doctor`, and clears the active stage only if no P0 findings remain.

## Hook Behavior

Hard blocking is reserved for execution-boundary integrity.

| Event | Behavior |
| --- | --- |
| `Setup` | Initialize plugin data and shape registry |
| `SessionStart` | Inject branch, dirty count, active stage, hook state, and shape summary |
| `UserPromptSubmit` | Remind Claude of active stage context |
| `PreToolUse Write/Edit` | Deny writes outside active-stage surfaces; inject shape context otherwise |
| `PreToolUse Bash` | Deny commit/push/merge/new stage while current stage is unfinished |
| `PostToolUse Write/Edit` | Run cheap AP detectors and shape discovery inline; run deterministic JIT async by default |
| `PostToolUse Bash` | Remind receipt discipline after proof command completion |
| `PostToolUseFailure` | Record failure context for receipt/replan |
| `PostToolBatch` | Emit one consolidated stage/check/AP summary |
| `TaskCompleted` | Block task completion with exit code 2 while a stage is open |
| `Stop` | Block stopping while a stage is open |
| `PreCompact`/`PostCompact` | Preserve and rehydrate execution state |
| `ConfigChange` | Block non-policy config changes during an active stage |
| `CwdChanged`/`FileChanged` | Keep watched active plans, stage state, hook state, and Zod shape registry fresh |
| `PermissionDenied` | Record auto-mode denials; allow retry only for safe SDD/proof commands |

## Configuration

The runtime reads low-friction options from `CLAUDE_PLUGIN_OPTION_*` environment variables. These names match Claude's plugin `userConfig` export format, while the manifest stays compatible with the local validator.

| Option | Default | Purpose |
| --- | --- | --- |
| `enforcement_mode` | `balanced` | `balanced` blocks only active-stage boundary violations; `advisory` never blocks |
| `jit_mode` | `async-rewake` | Runs deterministic checks in the background and wakes Claude only on failures |
| `shape_watch` | `true` | Refreshes shape registry when watched shape files change |
| `max_shape_context` | `12` | Caps injected shape summaries |
| `doctor_on_finish` | `true` | Runs `doctor` before clearing stage receipts |

## AP Envelopes

Advisory hooks do not block. They emit human-readable remediation plus a machine envelope:

```text
remediation prose

---
<!-- envelope:
{"type":"urn:zeroh-sdd:error:AP_PARSE_BOUNDARY","code":"AP_PARSE_BOUNDARY","_fix":{"prompt":"..."}}
-->
```

Claude reads the prose. Telemetry and repair tooling can extract the envelope. `_fix.prompt` is the canonical LLM repair payload.

## Verification

Run from the plugin directory:

```bash
npm test
```

This executes:

- `sdd-self-test`
- `sdd-doctor-self-test`
- `sdd-stage-self-test`
- `jit-router-self-test`
- `hook-runtime-self-test`
- `hook-watch-self-test`
- `async-jit-self-test`
- `runtime-config-self-test`
- `shape-registry-self-test`

## License

[Apache-2.0](LICENSE)
