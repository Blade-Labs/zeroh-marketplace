# zeroh-roadmap — multi-driver bindings

The one home for two things: which MODEL fills a protocol role (§1) and how a DRIVER is
launched and what it was proven able to do (§2). Nothing else may restate either — an agent
card, a skill or a lane prompt points here.

**Glossary — four words this plugin keeps distinct:**

| word | means | owner |
|---|---|---|
| **role** | a protocol spawn point (one per `agents/*.md` card): who is asked, in what class, down which model tier chain | `cli/lib/roles.mjs` |
| **driver** | a model-running CLI (`codex`, `claude`): binary, argv, prompt channel, sandbox posture, probed capabilities | `cli/lib/drivers.mjs` |
| **lane** | how work was launched — `run` / `review` (the codex command's missions), `session` / `codex` (the attribution vocabulary) | `cli/commands/codex.mjs`, `DriverShape` |
| **slot** | one mechanical gate check (`types`, `unit`, `build`…) | `cli/lib/slots.mjs` |
| **plane** | one phase of an arc, executed as a unit | `workflows/arc-plane.workflow.mjs` |

The **SEATS dispatcher** (an external consumer of the beacon/sidecar contract, DESIGN-NOTES.md
§2026-07-18) is none of these: it selects and verifies WORK, never models. "Seat" is its word;
this plugin says **role**.

## §1 Role bindings

`cli/lib/roles.mjs` holds `ROLES`, one frozen entry per agent card:

```
{ id, agentCard, spawnSites, class: 'judge'|'builder', tierChain, inlineFallbackLegal }
```

- **`class`** decides who may be re-routed: a consumer's `modelPolicy.judgeModel`
  (`roadmap.config.json`) overrides **judge-class roles only** — a role returning a verdict on
  work it did not produce. Builder-class roles (`phase-executor`, `software-developer`,
  `test-engineer`, `quality-pass`, `ux-designer`) ignore it.
- **`tierChain`** is model ids best-first. Only `software-architect` carries a real chain —
  **`claude-fable-5` → `gpt-5.6-sol` → `claude-opus-5`** (user ruling 2026-08-23, verbatim
  order), the plugin's highest-judgment seam. Every other role carries a 1-entry chain equal to
  its card's frontmatter alias. This table is the ONLY place a chain is written down.
- **Frontmatter `model:` stays** on each card as the harness fail-safe: a card cannot carry a
  full model id, so it carries the harness ALIAS (`fable`, `opus`, `sonnet`) and the chain head
  is that alias's registry id. `roles.test.mjs` fails when the two drift.
- **`spawnSites`** is the inventory of files that spawn the role, and it is evidence: each path
  must exist and mention the role id, or the suite reds.

### The resolver

`resolveRole(roleId, driverId, { forceUnavailable, judgeModel, env })` returns
`{ role, model, mode, substituted? }`.

- **The resolver drives the chain itself.** No harness fallback flag is a substitute: `claude
  --fallback-model` is single-hop and claude-family-only, so it can never reach `gpt-5.6-sol`.
- **A tier is unavailable** when `forceUnavailable` or `ROADMAP_ROLE_FORCE_UNAVAILABLE`
  (comma-separated model ids) names it, or when no registered driver runs it.
- **Falling down the chain never reduces rigor** — the same role runs, unabridged, on the next
  tier, and the walk is RECORDED: `substituted: { from, to, reason }`.
- **Every tier down** throws `RoleUnjudgedError` naming the role and each tier tried. A stage
  reported UNJUDGED is honest; a silently skipped one is not.
- **`mode`** is how this driver reaches that model, read off the registry: `native` (same
  driver, `subagents: 'native'`), `child-cli` (the model's runner declares a headless child
  mechanism — e.g. a Codex session filling the architect role via `claude -p --agents`), or
  `inline` (prompt-delivery: the driver runs the role itself). Inline is first-class and
  RECORDED — never indistinguishable from native — and refused for a role whose card forbids
  grading its own work (`inlineFallbackLegal: false`).

### The recording rule

Every firing is recorded into the phase's `executionResult.roles`
(`{ role, model, via, substituted? }`, `templates/schema.ts`). The deciding model is evidence:
a role binding that is not recorded did not happen as far as the scorecard is concerned.

## §2 Driver registry

`cli/lib/drivers.mjs` holds `DRIVERS`, one frozen entry per model-running CLI:

```
{ id, family, bin, model?,
  launch: { argv({ worktree, agents }), promptChannel, sandboxPosture },
  resume, roleCapabilities, verifiedAt: { date, host, command, output } }
```

- **Every launch argv lives here.** A launcher that carries its own model-specific argv is the
  drift the registry exists to kill (`drivers.test.mjs` ratchets it).
- **`model`** is what the launcher PINS on the argv — a command, not an observation. An entry
  without one records `driverStamp().model === null` rather than guessing.
- **`MODEL_DRIVERS` / `driverForModel(id)`** route a model id to the driver whose binary runs
  it. Routing only: presence there is not a capability claim.
- **`roleCapabilities`** carries only what that entry's `verifiedAt` output evidences. An absent
  key is unproven, never a claim of absence.
- **`verifiedAt`** carries the probe command and its output VERBATIM, stamped with the host it
  was proven on. A paraphrased probe is not evidence.

### verify / register

- `roadmap driver verify <id>` re-runs that driver's probes against the binary the registry
  names and writes `.building/driver-verify-<id>.json` (per-host, gitignored).
- `roadmap driver register <id>` REFUSES without fresh same-host provenance — report present,
  host equal to this host, every probe passed, probes naming this driver's own binary — and
  then prints the entry skeleton. It never edits the registry: the registry is committed code a
  human lands.
- An unregistered id is an EMPTY SLOT, never a guess — `resolveDriver` throws naming every
  known driver.
