# zeroh-sdd

Shape-Driven Development runtime for Claude Code.

`zeroh-sdd` turns vibecoding into a small executable proof loop:

```text
vibecoder intent -> execution-spec -> active-stage.json -> hooks enforce lane -> proof -> receipt -> next slice
```

The expected feel is low friction: silent when green, advisory when the current edit looks suspicious, and blocking only when Claude is about to violate the active execution stage.

## Quickstart

Install from Claude Code:

```text
/plugin marketplace add Blade-Labs/zeroh-marketplace
/plugin install zeroh-sdd@zeroh-marketplace
```

Runtime prerequisite: Node.js 18.18 or newer.

After installing or updating, restart Claude Code or start a fresh Claude session so the plugin skills and hooks load reliably.

Start work with a prompt like this:

```text
Use zeroh-sdd execution-spec for this change. Create the next proof gate, set the active stage, implement only inside that stage, run the proof command, and finish with a receipt.
```

Claude should then:

1. Use the `execution-spec` skill to create one next proof gate.
2. Put exactly one fenced `sdd` YAML block in the plan.
3. Run `zeroh-sdd check` and `zeroh-sdd doctor` on the plan.
4. Run `zeroh-sdd stage set` to write `.specify/workflows/active-stage.json`.
5. Edit only the declared stage surfaces.
6. Run the proof command.
7. Run `zeroh-sdd stage finish` to append the receipt and clear the stage.

## Update And Verify

Update from Claude Code:

```text
/plugin marketplace update zeroh-marketplace
/plugin update zeroh-sdd@zeroh-marketplace
```

Then restart Claude Code or start a new session.

Useful verification commands:

```bash
claude plugin list
claude plugin validate plugins/zeroh-sdd
zeroh-sdd self-test
```

If `zeroh-sdd` is not on `PATH`, run the bundled runtime directly:

```bash
node plugins/zeroh-sdd/bin/zeroh-sdd.mjs self-test
```

## Commands

The plugin ships a self-contained CLI:

```bash
zeroh-sdd check --plan <path>
zeroh-sdd doctor --plan <path>
zeroh-sdd stage set --stage <name> --step-id <id> --plan <path> --allow exact:<path> --proof-command <cmd> --stop-rule <rule>
zeroh-sdd stage finish --status passed|failed|blocked --proof-result <text> [--changed <path>] [--opened <id>] [--closed <id>] [--next-adjustment <text>]
zeroh-sdd stage status
zeroh-sdd stage clear
zeroh-sdd jit --file <path>
zeroh-sdd hook <event>
zeroh-sdd self-test
```

Claude hooks call the same runtime directly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-sdd.mjs" hook <event>
```

## State Contract

Project state lives in the consuming repo:

- `.specify/workflows/active-stage.json`: the runtime control plane for the current proof gate. It stores the stage name, step id, plan path, allowed paths, proof command, stop rule, receipt requirement, and open findings.
- `.specify/workflows/hook-state.json`: the latest hook/JIT summary. Findings are attributed by `scope`, `baselineStatus`, `introducedByCurrentEdit`, and `ownerAction`.

Finding scopes:

- `edited-file`: a finding on the file Claude just changed.
- `active-stage`: a finding on a declared active-stage surface.
- `proof-command`: a proof command or proof-gate failure.
- `repo-background`: branch health context that should not be blamed on the current edit.

Owner actions:

- `fix-now`: current-edit repair prompt.
- `receipt-note`: record context in the receipt.
- `replan`: stop and revise the execution spec.
- `branch-health-followup`: handle separately from the active slice.

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

While the stage is open:

- writes outside `allowedPaths` are denied
- commit, push, merge, and new stage setup are denied
- Stop and TaskCompleted are blocked until `stage finish` closes the receipt
- proof command completion triggers a receipt reminder
- AP findings stay advisory unless the active stage declares them as proof gates
- background branch-health findings are summarized without blaming the current edit

Finish the stage only after proof:

```bash
zeroh-sdd stage finish --status passed \
  --proof-result "pnpm test => pass" \
  --changed "src/route.ts" \
  --closed "SDD041" \
  --next-adjustment "Proceed to Step 2."
```

`stage finish` appends an execution receipt, runs `doctor`, and clears the active stage only if no blocking P0 findings remain.

## Tiny Smoke Test

In a disposable repo, ask Claude:

```text
Use zeroh-sdd execution-spec for a tiny change to src/route.ts. The only allowed file should be src/route.ts and the proof command should be node --version. After setting the stage, try to write forbidden.txt, then fix src/route.ts, run proof, and finish the receipt.
```

Expected infrastructure:

- `SessionStart` and `UserPromptSubmit` show active stage context.
- `PreToolUse Write/Edit` blocks `forbidden.txt`.
- `PostToolUse Write/Edit` emits advisory AP context only for current-edit or active-stage findings.
- `PostToolUse Bash` reminds Claude to write the receipt after `node --version`.
- `Stop` and `TaskCompleted` block while the stage is still open.
- `stage finish` writes a receipt and clears `.specify/workflows/active-stage.json`.

## Hook Behavior

Hard blocking is reserved for execution-boundary integrity.

### Wired In Current Claude Build

These events are declared in `hooks/hooks.json` and are live when the plugin is enabled:

| Event | Behavior |
| --- | --- |
| `Setup` | Initialize plugin data and shape registry |
| `SessionStart` | Inject branch, dirty count, active stage, hook state, and shape summary |
| `UserPromptSubmit` | Remind Claude of active stage context |
| `PreToolUse Write/Edit` | Deny writes outside active-stage surfaces; inject shape context otherwise |
| `PreToolUse Bash` | Deny commit, push, merge, and new stage setup while a stage is unfinished |
| `PostToolUse Write/Edit` | Run cheap AP detectors and shape discovery inline; run deterministic JIT async by default |
| `PostToolUse Bash` | Remind receipt discipline after proof command completion |
| `PostToolUseFailure` | Record failure context for receipt or replan |
| `TaskCompleted` | Block task completion with exit code 2 while a stage is open |
| `PreCompact` | Preserve execution state before compaction |
| `Stop` | Block stopping while a stage is open |
| `ConfigChange` | Block non-policy config changes during an active stage |
| `SessionEnd` | Close silently |

### Runtime-Supported But Not Currently Wired

The runtime has handlers for these events, but this plugin version does not declare them in `hooks/hooks.json` because the installed Claude build used for validation does not accept them as live hook entries:

- `PostToolBatch`
- `PostCompact`
- `CwdChanged`
- `FileChanged`
- `PermissionDenied`

They are covered by runtime self-tests only.

## Configuration

The runtime reads advanced low-friction options from `CLAUDE_PLUGIN_OPTION_*` environment variables. The plugin manifest intentionally does not expose `userConfig` until the local Claude validator supports it for this marketplace.

| Option | Default | Purpose |
| --- | --- | --- |
| `enforcement_mode` | `balanced` | `balanced` blocks only active-stage boundary violations; `advisory` never blocks |
| `jit_mode` | `async-rewake` | Runs deterministic checks in the background and wakes Claude only on failures |
| `shape_watch` | `true` | Refreshes shape registry when watched shape files change |
| `max_shape_context` | `12` | Caps injected shape summaries |
| `doctor_on_finish` | `true` | Runs `doctor` before clearing stage receipts |

## AP Envelopes

Advisory hooks do not block. Current-edit APs emit human-readable remediation plus a machine envelope:

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
- `skill-content`
- `hook-manifest-self-test`
- `docs-ux-self-test`

## License

[Apache-2.0](LICENSE)
