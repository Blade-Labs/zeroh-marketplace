# Phase file contract: shapes, markers, and task design rules

The literal authoring contract for `<root>/phases/phase-<N>.phase.ts`. `roadmap phase validate <N>`
parses and emits against this shape; treat a validate failure as a contract violation to fix, never
to waive.

Write `<root>/…`, never a bare `roadmap/…`: the roadmap root is DISCOVERED. Rule: `skills/using-zeroh-roadmap/SKILL.md` (mechanics: its `references/layout.md`). A phase file imports the schema RELATIVELY — `import { definePhase } from
'../lib/schema'` — never through a `@/` tsconfig alias, which most consumers do not define. A
consumer still carrying the legacy toplevel schema seam keeps its existing imports; both resolve.

## The definePhase shape (verbatim)

```ts
definePhase({
  phase, name, plannedBy: { model: '<your own model id>' }, status: 'backlog',
  category, kind, source, priority,
  dependsOn, conflictsWith, keyFiles, stakeholderDemo,
  userFacing?, flag?, testScope?, reviewScope?, arcId?,
  assumptions?: [{ claim, verify: '<one runnable command>', onFalse: 'ESCALATE' }],
  tasks: [{ id, title, problem, steps: [{ file, description, line? }],
            acceptanceCriteria, files, testMode?, dependsOn?, batchMode?, done: false }],
})
```

- `stakeholderDemo` = the changelog line, written for the stakeholder, not the executor.
- `steps[].description` MUST end `" → verify: <one command or observable>"` (rehearsed per
  `references/verify-rehearsal.md`).
- `steps[].line` is optional and approximate; the symbol name is the real anchor, copy-pasted from
  the file (a FLUENTFRONT tripwire went false-negative on a case-variant retype).
- `batchMode` is TASK-level (it sits inside the task object; `templates/schema.ts` `PhaseTaskShape`).
  Set `batchMode: true` ONLY for genuinely mechanical multi-commit work where the unit of intent
  is one task but the unit of commit is many (a rename across >10 files, N parallel shapes from a
  template), never to excuse an oversized ordinary task; do-phase then commits per step. Sub-agent
  forks stay forbidden: batchMode is permission for many commits inline, not for spawning agents.
  It is the only thing that relaxes the plan-time size refusal (`files ≤10` / `steps ≤6` per
  task). That refusal is plan-phase/review-phase's own act per the `PhaseTaskShape` docblock;
  `roadmap phase validate` does NOT size-check; `roadmap audit` check 11 reds escapes at HIGH.
- `tasks[].dependsOn` (task ids like `'12.2'`): omit for strict sequential; list explicitly when a
  task can start earlier than its position suggests. Cross-phase deps go on the Phase field.
- `tasks[].interfaces` (optional `{ consumes: string[], produces: string[] }`): the cross-task
  contract, filled ONLY when this task consumes a sibling task's output or produces one a later
  task relies on. Entries are exact symbol/contract names — never prose. The WIRED check is execution-side:
  do-phase/phase-executor `grep -F` each consumed terminal identifier before building;
  `produces` is reviewer-judgment material (no wired grep). Example:
  `interfaces: { consumes: ['makeWorkIqClient(fetch?) from 12.1'], produces: ['WorkIqApiError'] }`.
  Omit entirely for self-contained tasks; an empty object is noise, not a signal.

## `[NEEDS CLARIFICATION]` markers

Precondition: a software-architect `ESCALATE_TO_USER` verdict (see SKILL.md Prime Rule 2). Embed in
the task's `problem` or `acceptanceCriteria`, naming ONE specific question, never "TBD". Enforced:
`do-phase` and `review-phase` refuse a marked phase, so a marked phase can exist on disk but can
never execute.

## `userFacing` + `flag` shapes

The posture is the consumer CLAUDE.md rule "Flag-first delivery": cite that rule in the plan,
never restate it (a restated paraphrase is exactly how a default-polarity drift once shipped).
The two schema shapes:

- `flag: { id: 'FLAG_ID' }`: a FlagId registered in `src/flags/registry.ts`.
- `flag: { bootWired: true, justification }`: joins `src/release/feature-manifest.ts`; the
  justification (min 20 chars, schema-enforced) is where boot-wiring without a runtime switch is
  ratified.

`roadmap phase validate` reds `userFacing: true` with no `flag` (rule `userFacing-without-flag`).
A non-user-facing phase declares `userFacing: false` in the file plus one notes line saying why no
flag applies; the claim never lives only in the chat report.

## `testScope` / `reviewScope`

`testScope` (only when the consumer config sets `testCadence`; <root>/roadmap.config.json does):
`static` / `scoped` (list `scopedTests`) / `relevant` / `full`. Asymmetric by design: a declared
value may only RAISE the floor derived from the actual diff, never lower it; a `gateSpecialists`
path floors to `relevant`. Declare it for a known data/docs-shaped phase.

`reviewScope` (the agent-chain ladder; a plan-time judgment of what review is high-value):
`none` (docs/data) · `light` (small/mechanical: one reviewer, no quality pass) · `full` (new seams,
subtle logic, governed paths). A declared value MAY lower the rung, but only with a phase-notes
line saying WHY the skipped stages are low-value; review-phase Mode A ratifies it (unjustified low
= NEEDS WORK). Hard floor: a `gateSpecialists` path always runs `full`.

## Task design rules

- Real `steps[].file` paths; a concrete `steps[].description` with its `→ verify:` clause; 1-4
  observable `acceptanceCriteria` (a lane command or a grep counts; verifiable does NOT mean a
  test); zero proves nothing and past four the criteria just restate the steps; complete `files[]`.
- **State coverage:** when the changed behavior has a lifecycle (first run vs re-run, empty vs
  populated, cold vs warm layout), at least one criterion exercises the NON-initial state
  (BRAINVIEW's cold-layout-only criteria shipped a geometry fix inert at real prod density).
- **Ordering:** owned by SKILL.md Step 3 (foundation → consumers → validation last, deps flow
  downward); not restated here. The vertical-slice rule for `userFacing: true` phases: a
  layer-batched task list (all schema, then all API, then all UI) leaves nothing testable until
  the last layer lands — order tasks so each slice reaches an observable behavior early;
  foundation → consumers governs dependency DIRECTION within a slice, never layer batching
  across the phase.
- **`testMode`:** assigned per `skills/using-zeroh-roadmap/references/test-worthiness.md`: `tdd`
  where it earns its keep (pure logic/contracts/error paths), `e2e` for real-boundary user flows,
  `none` for everything else including the NEVER classes (declarative artifacts, UI presentation,
  process guards; an owed guard goes to the consumer's ratchets/lint/emit lane, named in the step,
  its `→ verify:` that lane's command). Default `none` when unsure (TDD costs ~5 min/task). A
  testMode contradicting the rule is plannable ONLY with a recorded software-architect Decision
  Contract verdict in the phase notes.
- **Standards citations:** a task producing or touching a doc names
  `skills/using-zeroh-roadmap/references/documentation-rules.md` as its standard; a UI task names
  its component placement (shared home vs own folder) per
  `skills/using-zeroh-roadmap/references/component-structure.md`; a task introducing an external
  dependency or asset names its license + placement tier per
  `skills/using-zeroh-roadmap/references/external-assets-licensing.md` (unknown license = not
  plannable). Gotcha: symptom = one of these four paths absent under the INSTALLED plugin cache
  (older caches predate them); response = read the dev-tree copy at
  `/home/patrik/zeroh-marketplace/plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/`.
- **Hypotheses block** (`category:'fix'` / `kind:'hardening'` only): phase `notes` carries
  `## Hypotheses` with ≥2 ranked causes, a one-line refutation or evidence each, exactly ONE
  `CONFIRMED` with concrete evidence (file:line, failing test, or repro SHA), the rest `REFUTED`
  or `NOT TESTED`.
- **Anti-patterns (all fail Prime Rule 1):** `description:'Implement task N.1'`,
  `acceptanceCriteria:['Task N.1 verified']`, `problem:'This needs to be done'`,
  `title:'Fix things'`.
- **Special task types:** an *investigation task* when the root cause is unknown; a *gate task*
  last.

## Timing annotation grammar

From `<root>/arc-evals/timing-stats.json` (cohort = task-count band × surface, surface = any
`keyFiles` path matching `web/`, `office/` or `spa/`):

```
timing: band 4-6 × surface:false, N=8, median 60.8 min, p80 83.3 min
timing: no reference data for <band>×<surface>
```

Always class AND N, or the honest-absent form. Never a bare or invented number: a range whose
sample size nobody can see is clock-feel wearing a citation.
