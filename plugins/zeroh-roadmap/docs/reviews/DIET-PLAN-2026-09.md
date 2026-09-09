> Historical investigation record. This describes an earlier implementation, not the current execution contract. See [README.md](../../README.md) and [MULTI-DRIVER.md](../../MULTI-DRIVER.md).

# Protocol diet plan — September 2026

This map is the binding input to phase 26.3. A paragraph is a Markdown block separated by a blank line; frontmatter is one block. Every source block below has exactly one disposition. Incident-bearing passages are relocated, never deleted. Measurements use source bytes and the repository token estimator before edits.

## plugins/zeroh-roadmap/skills/do-phase/SKILL.md

Roll-up: **35 paragraphs mapped / 35 source paragraphs**; 185 lines and 12219 bytes before; projected 11083 bytes after (reference text excluded from model-loaded body).

| # | anchor | class | disposition | evidence |
|---:|---|---|---|---|
| 1 | --- name: "Do Phase" description: "Execute a roadmap phase task-by-task with enforced se | decision | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 2 | # Do Phase — Sequential Execution Protocol | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 3 | **Trigger:** \`do phase N\`, \`/do-phase N\`, \`do next phase\` (→ \`roadmap status\`).  | vocabulary | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 4 | ## PRIME RULE 1 — no compromises; escalate to the ARCHITECT, not the user | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 5 | Senior-architect rigor per task: magic numbers → constants, ambiguity → throw, no TODO d | decision | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 6 | **Before you would** (a) write a non-\`"None"\` \`compromises\`/\`hardcoded\`/\`skipped\ | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 7 | One compromise = one architect call, no batching. Three+ in a phase = the plan is too br | decision | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 8 | ## PRIME RULE 2 — one task at a time | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 9 | Batching loses work. **Never** batch tasks, launch parallel agents for tasks, reorder/sk | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 10 | ## Step 0 — read the phase; run the tripwires | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 11 | **Worktree lane first** (a STANDALONE phase, when the consumer's \`roadmap.config.json\` | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 12 | Read the phase (\`status\` must be \`backlog\`/\`in-progress\`; terminal = stop). If it  | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 13 | ## The per-task loop (one task = one commit) | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 14 | For each task in order: 1. **Implement \`steps\`** (\`interfaces.consumes\`: \`grep -F\` | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 15 | **Batch tasks (\`batchMode: true\`, mechanical only):** one commit per \`steps[]\` entry | vocabulary | relocate → plugins/zeroh-roadmap/skills/do-phase/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/do-phase/references/protocol-details.md, cited from the operative body at point of use. |
| 16 | ## Transparency contract (per task) | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 17 | **Durable-lesson moment** — an error you recovered, a user correction, a surprising re-d | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 18 | Persist all six fields — \`whatWasDone\`, \`how\` (real content), and \`compromises\`/\` | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 19 | ## Commit grammar (BINDING — the CLI parses these subjects) | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 20 | \`docs(roadmap): phase N — <desc>\` · task commits carry \`phase N\` + the task id · \`f | vocabulary | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 21 | **The LANDED subject** (what \`phase curate\` composes, and the style every commit that  | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 22 | ## The gate (after the last task) | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 23 | \`roadmap gate plan <N>\` resolves the \`kind\` cell: mockup = lint+types; logic = Round | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 24 | **Design-parity stage** (a task cites a \`ux\` designRef AND the diff touches a rendered | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 25 | **Echo contract:** after each gate-agent stage echo a ~10-line summary to chat (\`[Quali | contract | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 26 | **Sub-agent rule:** gate agents run synchronously; only the architect and \`test-enginee | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 27 | ## Curate the landed history | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 28 | After the gate goes green, before Complete + return (that order is BINDING): run \`roadm | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 29 | ## Complete + return | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 30 | Set in ONE edit: \`status: 'done'\`, \`gate\`, \`gateRounds\` (Round 0 at index 0, ≥1 en | vocabulary | enforced-by-code(cli command and its command tests) | The named CLI command or schema parse performs this mechanical transition; the body keeps only judgment at the call site. |
| 31 | **Arc-mode** (iff \`<root>/.arc-mode\` exists — read via \`roadmap status\` — OR this se | vocabulary | enforced-by-code(cli command and its command tests) | The named CLI command or schema parse performs this mechanical transition; the body keeps only judgment at the call site. |
| 32 | **Standalone** (no arc-mode): after the completion commit, groom \`<root>/backlog.ts\` ( | vocabulary | relocate → plugins/zeroh-roadmap/skills/do-phase/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/do-phase/references/protocol-details.md, cited from the operative body at point of use. |
| 33 | ## Codex delegation lane (\`roadmap codex run <N…>\`) | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 34 | When the session delegates implementation to Codex, use the CLI lane — never hand-roll t | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 35 | **Integration routing (after CODEX-RUN-COMPLETE):** run \`roadmap phase land <N>\` INSID | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |

## plugins/zeroh-roadmap/skills/do-arc/SKILL.md

Roll-up: **16 paragraphs mapped / 16 source paragraphs**; 150 lines and 10350 bytes before; projected 10057 bytes after (reference text excluded from model-loaded body).

| # | anchor | class | disposition | evidence |
|---:|---|---|---|---|
| 1 | --- name: "Do Arc" description: "Execute a whole arc end to end: drive the per-plane CLI | methodology | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 2 | # Do Arc — Arc Orchestration | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 3 | \`do-arc\` ships an Arc by driving ONE deterministic loop per plane. Every transition is | vocabulary | relocate → plugins/zeroh-roadmap/skills/do-arc/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/do-arc/references/protocol-details.md, cited from the operative body at point of use. |
| 4 | You drive the loop INLINE with Bash CLI calls + one subagent spawn per executor-band pha | vocabulary | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 5 | ## Trigger | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 6 | \`do arc <id>\`, \`/do-arc <id>\`, \`execute arc <id>\`, \`run arc <id>\`. Options: \`-- | vocabulary | relocate → plugins/zeroh-roadmap/skills/do-arc/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/do-arc/references/protocol-details.md, cited from the operative body at point of use. |
| 7 | ## Run it | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 8 | 1. \`roadmap arm <id> [--models <arg>]\` — claim lane (refuses siblings); \`roadmap    s | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 9 | ## The loop's non-done exits — you own them | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 10 | - **Inline handoff** (a trivial/heavy band phase, or \`--inline\`) → run THAT phase inli | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 11 | ## Terminal handoffs (in-session) | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 12 | 1. **sweep** → run the \`arc-sweep\` skill (disposes the batched per-phase debt, judges  | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 13 | ## Pause & resume | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 14 | Pause anywhere; \`roadmap arc next\` resumes from disk. Keep optional arc-loop notes in  | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 15 | ## Execution-prompt doc | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 16 | \`<root>/arc-prompts/<id>-execution-prompt.md\` is authored at arc-planning time, not he | vocabulary | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |

## plugins/zeroh-roadmap/skills/arc-sweep/SKILL.md

Roll-up: **27 paragraphs mapped / 27 source paragraphs**; 130 lines and 8899 bytes before; projected 8505 bytes after (reference text excluded from model-loaded body).

| # | anchor | class | disposition | evidence |
|---:|---|---|---|---|
| 1 | --- name: "Arc Sweep" description: "Pre-merge sweep for a built arc: dispose every accum | vocabulary | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 2 | # Arc Sweep — Pre-Merge Debt + Whole-Arc Review | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 3 | **Not this skill:** \`release-sweep\` owns pre-release followup triage and archive; arc- | vocabulary | relocate → plugins/zeroh-roadmap/skills/arc-sweep/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/arc-sweep/references/protocol-details.md, cited from the operative body at point of use. |
| 4 | After \`do-arc\` builds every phase, \`arc-sweep\` disposes debt, runs ONE whole-arc arc | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 5 | **Read \`skills/release-sweep/SKILL.md\` FIRST.** arc-sweep reuses release-sweep's debt- | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 6 | arc-sweep is NOT \`full-code-review\` — it is a lighter, seam-specific architect pass. | vocabulary | relocate → plugins/zeroh-roadmap/skills/arc-sweep/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/arc-sweep/references/protocol-details.md, cited from the operative body at point of use. |
| 7 | ## Step 1: Consolidated debt sweep | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 8 | Use \`do-arc\`'s complete \`PhaseExecutionResult[]\`; if missing/short, call \`discoverR | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 9 | **Disposition → persistence (mechanical — read the row):** | decision | relocate → plugins/zeroh-roadmap/skills/arc-sweep/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/arc-sweep/references/protocol-details.md, cited from the operative body at point of use. |
| 10 | \| Disposition \| Meaning \| \`debtResolutions[]\` \| \`status\` \| \`via\` \| \|---\|-- | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 11 | (\`limitations\` never enter this table — see below.) | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 12 | Whenever OPERATOR-PENDING creates a NEW \`<root>/followups/<arcId>.md\`, prepend the \`s | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 13 | **Disposition mode — read \`mergePolicy\` from \`roadmap.config.json\` first.** Under do | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 14 | Each code-disposition persists exactly one \`debtResolutions[]\` entry (\`{ ref: '<taskI | vocabulary | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 15 | - **RESOLVE-NOW** == release-sweep **(f) Fix inline** → invoke \`zeroh-roadmap:software- | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 16 | **\`limitations\` are out of scope — by design.** The roll-up carries \`compromises\`/\` | vocabulary | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 17 | **No summary file.** Keep the audit trail in \`debtResolutions[]\` + transparency report | vocabulary | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 18 | ## Step 2: Whole-arc cross-phase review (against singleSeams + designRefs) | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 19 | Run ONE \`zeroh-roadmap:software-architect\` over \`git diff <arc.baseRef>..HEAD\` and j | vocabulary | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 20 | **Design-conformance — judge against \`arc.designRefs\` too.** Read the arc's confirmed  | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 21 | **Ledger-audit clause (when the arc trims plugin/skill prose).** If the arc diff deletes | contract | relocate → plugins/zeroh-roadmap/skills/arc-sweep/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/arc-sweep/references/protocol-details.md, cited from the operative body at point of use. |
| 22 | Apply any **RESOLVE-NOW** fixes the architect identifies and **re-gate each** to its pha | vocabulary | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 23 | ## Step 2.5: Estate ratchets — the whole-tree conformance pack, ONCE per arc | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 24 | When the consumer binds \`gateCommands.ratchets\`, run it **FOREGROUND** after the whole | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 25 | ## Step 3: Record, then report merge-readiness | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 26 | Assemble ONE \`SweepReportShape\` document (the shape's own docblocks define every field | vocabulary | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 27 | THEN render the chat report FROM that document: it is a PROJECTION, so a fact not in the | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |

## plugins/zeroh-roadmap/skills/validate-arc/SKILL.md

Roll-up: **21 paragraphs mapped / 21 source paragraphs**; 107 lines and 7486 bytes before; projected 6870 bytes after (reference text excluded from model-loaded body).

| # | anchor | class | disposition | evidence |
|---:|---|---|---|---|
| 1 | --- name: "Validate Arc" description: "Drive a built arc's real shipped flow and judge i | decision | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 2 | # Validate Arc — Intent Validation Protocol | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 3 | \`validate-arc\` closes the arc loop: resolve \`acceptanceCriteria\`, drive the real flo | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 4 | **Trigger:** \`validate arc <id>\`, \`/validate-arc <id>\`; also \`do-arc\`'s close-out  | vocabulary | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 5 | ## Step 0: Resolve the arc + its criteria | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 6 | 1. \`discoverArcs()\` → the arc whose \`id\` equals \`<id>\`. None → STOP: \`No arc with | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 7 | ## Step 1: Confirm the arc is built and runnable 1. Every member phase across \`arc.plan | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 8 | ## Step 2: Tier-pick — honour each criterion's tier, with a tier-honesty down-check | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 9 | The tier vocabulary — what each can/can't honestly judge, its evidence, the consumer bin | vocabulary | relocate → plugins/zeroh-roadmap/skills/validate-arc/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/validate-arc/references/protocol-details.md, cited from the operative body at point of use. |
| 10 | Each criterion carries its \`tier\` (the cheapest that can honestly judge it). Honour it | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 11 | ## Step 3: Fan out the judge — one \`intent-validator\` per criterion, in parallel | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 12 | Spawn \`intent-validator\` **once per criterion, concurrently**. **Spawn each with \`mod | vocabulary | relocate → plugins/zeroh-roadmap/skills/validate-arc/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/validate-arc/references/protocol-details.md, cited from the operative body at point of use. |
| 13 | - **Edit-confinement:** judges are READ-ONLY — they drive and observe, writing NOTHING i | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 14 | For a **subjective** \`bar\` (rendered-UX / "feels finished", typically \`live-ui\`), sp | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 15 | ## Step 4: Collect, aggregate, report | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 16 | 1. \`.parse()\` each \`IntentVerdict\` (typed shape — reject free prose; a mis-shaped ju | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 17 | Report per-criterion verdict + evidence + the tier judged at (+ any tier-honesty flag),  | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 18 | ## Step 5: Corrective loop (on GAPS) — bounded | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 19 | A GAPS result feeds a fix-and-re-check loop that **reuses \`plan-phase\` + \`do-phase\`* | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 20 | 1. **Author a corrective phase per gap via \`plan-phase\`** — \`problem\` = \`whatsMissi | vocabulary | relocate → plugins/zeroh-roadmap/skills/validate-arc/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/validate-arc/references/protocol-details.md, cited from the operative body at point of use. |
| 21 | Loop until PASS or the **bound** trips: \`maxRounds\` default **2** + a budget cap. **Ex | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |

## plugins/zeroh-roadmap/skills/release-sweep/SKILL.md

Roll-up: **18 paragraphs mapped / 18 source paragraphs**; 106 lines and 6781 bytes before; projected 6033 bytes after (reference text excluded from model-loaded body).

| # | anchor | class | disposition | evidence |
|---:|---|---|---|---|
| 1 | --- name: "Release Sweep" description: "Review and resolve outstanding debts for a relea | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 2 | # Release Sweep — Resolve Debts and Archive a Version | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 3 | **Not this skill:** \`arc-sweep\` owns pre-merge arc debt; release-sweep owns pre-releas | vocabulary | relocate → plugins/zeroh-roadmap/skills/release-sweep/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/release-sweep/references/protocol-details.md, cited from the operative body at point of use. |
| 4 | **Trigger:** \`release-sweep\`, \`release-sweep 0.7.0 [--archive]\`, \`archive 0.7.0\`,  | vocabulary | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 5 | \`\`\` release-sweep [<version> \| --arc <id> \| --all-done] [--archive] \`\`\` | vocabulary | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 6 | - \`<version>\` — bare semver (no \`v\` prefix); omitted with no selector → prompt, neve | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 7 | > **Estate scale:** start with \`roadmap debt census\`; \`roadmap debt check\` is the CI | vocabulary | enforced-by-code(cli command and its command tests) | The named CLI command or schema parse performs this mechanical transition; the body keeps only judgment at the call site. |
| 8 | ## PRIME RULE: ARCHIVE GATES ON CLEAN DEBTS | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 9 | **Release does NOT gate on debts** — a phase can ship with open debts on any release if  | contract | relocate → plugins/zeroh-roadmap/skills/release-sweep/references/protocol-details.md | Rarely consulted mechanics remain available in plugins/zeroh-roadmap/skills/release-sweep/references/protocol-details.md, cited from the operative body at point of use. |
| 10 | ## Protocol | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 11 | ### Step 1 — Locate done phases Find the version's phase files (\`roadmap debt census\`  | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 12 | ### Step 2 — Aggregate open debts (join transparency reports × debtResolutions) This joi | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 13 | ### Step 2.5 — Triage followup files (minor/major; patches exempt) Run \`roadmap followu | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 14 | ### Step 3 — Resolve each open debt (interactive; do NOT auto-resolve) Each item gets an | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 15 | ### Step 4 — Summary Report counts (fixed inline / fixed new-phase / won't_fix / dismiss | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 16 | ### Step 5 — Archive (only if \`--archive\` and zero open) — the git-mv mechanics (PROSE | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 17 | ## Edge cases + scope Zero debts is archive-eligible. Skip/warn \`version: undefined\`;  | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 18 | **No summary file.** The phase files ARE the audit trail (\`debtResolutions[]\` + the tr | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |

## plugins/zeroh-roadmap/agents/phase-executor.md

Roll-up: **13 paragraphs mapped / 13 source paragraphs**; 109 lines and 7640 bytes before; projected 6809 bytes after (reference text excluded from model-loaded body).

| # | anchor | class | disposition | evidence |
|---:|---|---|---|---|
| 1 | --- name: phase-executor description: Runs do-phase for ONE phase end-to-end inside an a | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 2 | You are the **phase-executor** — run \`do-phase\` for ONE phase end to end, then return  | contract | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 3 | ## The five NEVER-rules | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 4 | 1. **Never narrow an acceptance criterion.** Blocked, or the only path narrows the promi | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 5 | ## The task loop (re-anchor after every task) | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 6 | **Step 0:** run the \`assumptions[]\` tripwires — a failed \`verify\` escalates BEFORE a | rationale | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 7 | ## The gate + return | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 8 | After the last task run the \`kind\`-selected gate — \`roadmap gate plan <N>\` → \`gate  | vocabulary | enforced-by-code(cli command and its command tests) | The named CLI command or schema parse performs this mechanical transition; the body keeps only judgment at the call site. |
| 9 | ## Spawn boundary + return | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 10 | You hold \`Agent\` ONLY for do-phase's authorized sub-agents — \`software-architect\`, \ | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 11 | **An in-turn read that comes back EMPTY is the same failure.** Its main cause — this gua | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 12 | - **NEVER poll a subagent's \`.output\` / transcript file for a verdict.** It is not a c | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 13 | Your final message IS the \`PhaseExecutionResult\` (\`PhaseExecutionResultShape\`): \`"d | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |

## plugins/zeroh-roadmap/agents/quality-pass.md

Roll-up: **8 paragraphs mapped / 8 source paragraphs**; 71 lines and 5543 bytes before; projected 5528 bytes after (reference text excluded from model-loaded body).

| # | anchor | class | disposition | evidence |
|---:|---|---|---|---|
| 1 | --- name: quality-pass description: One-shot end-of-phase quality sweep — the merged arc | methodology | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 2 | Run both mandates in order over one diff. Correctness belongs to the code-reviewer; repo | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 3 | **Commit grammar:** MUST bind subjects: \`type(scope): phase N — <what>\`; task form \`p | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 4 | ## Mandate A — architect sweep (additive); the per-task gate caught most shortcuts, you  | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 5 | **AUTO-FIX** all four + same-repo breaking-contract updates (rename every caller) + DB/s | contract | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 6 | ## Mandate B — simplify sweep (subtractive); strong bias to deletion, ONLY lines this ph | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 7 | **Do NOT:** style rewrites (renames/import-reorders/arrow-swaps/ternary-collapsing — exp | methodology | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 8 | ## Protocol 1. Read \`git diff <phase-start-SHA>..HEAD\` + the phase file (transparency  | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |

## plugins/zeroh-roadmap/agents/code-reviewer.md

Roll-up: **11 paragraphs mapped / 11 source paragraphs**; 68 lines and 4815 bytes before; projected 4571 bytes after (reference text excluded from model-loaded body).

| # | anchor | class | disposition | evidence |
|---:|---|---|---|---|
| 1 | --- name: code-reviewer description: Reviews code for bugs, logic errors, pattern adhere | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 2 | You are an expert code reviewer — bugs, logic errors, and business-rule violations, not  | contract | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 3 | **Confidence + severity — ONE rubric (this file is the single home).** Report only findi | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 4 | **Consumer review focus — read FIRST.** Read the consumer's **\`reviewFocus\`** config k | vocabulary | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 5 | **Generic focus:** logic errors (undefined refs, stale closures, races, off-by-one) · bu | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 6 | **Round scope.** Round 1 reviews the phase diff. For round ≥2, read \`roadmap gate round | vocabulary | relocate → agents/references/code-reviewer-details.md | Rarely consulted mechanics remain available in agents/references/code-reviewer-details.md, cited from the operative body at point of use. |
| 7 | **New guards — audit the evidence, never re-derive it.** A NEW guard in the diff (a chec | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 8 | **Verify-then-report (mandatory).** Before reporting ANY finding, re-\`Read\` the flagge | vocabulary | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 9 | **Output — typed findings.** Return a fenced JSON array matching \`StructuredGateRound.f | vocabulary | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 10 | \`\`\`json [ { "file": "src/x.ts", "line": 42, "severity": "HIGH", "confidence": 90,     | vocabulary | keep | Executor judgment or sequencing remains model-loaded because code cannot choose it safely. |
| 11 | \`severity\` ∈ \`CRITICAL\`/\`HIGH\`/\`MEDIUM\`/\`LOW\` (the \`GateFindingShape\` enum;  | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |

## plugins/zeroh-roadmap/agents/software-architect.md

Roll-up: **9 paragraphs mapped / 9 source paragraphs**; 61 lines and 4572 bytes before; projected 4555 bytes after (reference text excluded from model-loaded body).

| # | anchor | class | disposition | evidence |
|---:|---|---|---|---|
| 1 | --- name: software-architect description: Designs system architecture by analyzing exist | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 2 | **Model policy - one home: \`MULTI-DRIVER.md\` §1** (role table + resolver in \`cli/lib/ | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 3 | You are a senior software architect delivering decisive, immediately-implementable bluep | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 4 | ## Decision Contract (do-phase / plan-phase / release-sweep) Return EXACTLY ONE of: - ** | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 5 | **No recursion.** You MUST NOT invoke another \`software-architect\` (or \`quality-pass\ | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 6 | **Verify on the way.** Read files, grep for existing utilities, confirm the functions yo | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 7 | ## Method Be decisive (pick ONE approach, brief trade-offs, then recommend). Study the c | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 8 | **Architecture reference — the \`designHomes\` config-read.** The consumer's canonical a | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |
| 9 | Gray-zone license calls (dual-licensed, custom terms) route through the Decision Contrac | contract | keep | Operative routing, contract, or judgment boundary; no equivalent mechanical enforcement replaces it. |

## Projected flow ceilings

| flow | before ceiling | projected ceiling | basis |
|---|---:|---:|---|
| do-arc | 13,339 tokens | ≤11,338 tokens | At least 15% below the binding ceiling; phase 26.3 ratchets to the measured result. |
| do-phase | measured before phase 26.3 | measured after phase 26.3 | Recorded by `roadmap measure` in the ledger. |
| plan-arc | measured before phase 26.3 | measured after phase 26.3 | Recorded by `roadmap measure` in the ledger. |

## Ratification

**VERDICT: PROCEED_WITH_FIX** — ratified only with the binding overrides and clause-level rows below. Deciding model: `claude-fable-5` (resolved from the `codex` model-policy preset and fired once over the whole map).

The architect confirmed that all source paragraphs are accounted for, but rejected generic evidence and an asserted 15% projection. Phase 26.3 MUST follow these amendments over any conflicting generated row:

| source row / clause | amended class | amended disposition | specific evidence |
|---|---|---|---|
| do-phase 30, completion fields | contract | keep the `executionResult.driver` and one-edit completion instruction; enforce only the rejected shapes | `roadmap gate run --verify-complete`, `cli/lib/validate.mjs` done-transition check, and `cli/commands/gate.test.mjs`; driver absence is scored rather than refused, so its instruction remains loaded. |
| do-phase 31, arc-mode return | contract | keep | The explicit skip-groom/emit/push boundary prevents shared-checkout mutation; no command refuses an executor that violates it. |
| phase-executor 8, gate + return | contract | keep | This instruction produces the gate-stage beacons, modeled rounds, verify-complete evidence, completion fields, and typed return consumed by the adherence scorer. |
| release-sweep 7, census routing | methodology | keep | `roadmap debt census` implements enumeration, but the body must still route the executor to invoke it first. |
| do-arc 3, operating model and CLI fallback | contract | keep | Consulted on every run; relocating it would require every run to load the reference and yield no flow saving. |
| do-arc 6, trigger options | vocabulary | keep | Kept rows 8 and 10 consume `--models` and `--inline`; keeping the option vocabulary prevents a dangling reference. |
| validate-arc 12, judge spawning/model routing | contract | keep | `DIET-LEDGER.md` §validate-arc records judge-model routing as KEEP-LIST; validation executes it on every run. |
| code-reviewer 6, later-round scope | contract | keep | `roadmap gate round-brief` provides the delta and `priorFindings`, but only this card instructs the reviewer to consume both. |
| release-sweep 9, release does not gate on debt | decision | keep | This is the anti-over-blocking half of the prime rule and cannot be inferred safely from the census command. |
| arc-sweep 21, ledger audit | contract | relocate mechanics → `skills/arc-sweep/references/protocol-details.md`; keep trigger in body | The surviving trigger must say: when an arc diff trims model-loaded prose, load the reference and audit every deletion against `DIET-LEDGER.md`. |
| phase-executor 6, stale-line-number story | rationale | relocate story → `agents/references/phase-executor-details.md`; keep tripwire/task rules | The dated 2026-08-17 incident is provenance, while `roadmap phase start` and task-start sequencing remain operative. |
| phase-executor 11–12, API-529/four-hour stories | rationale | relocate stories → `agents/references/phase-executor-details.md`; keep empty-read and completion-channel rules | Incident narration is retained on demand; the no-transcript-polling and empty-read rules remain model-loaded. |
| do-phase 20, `136`/`1369` example | rationale | obsolete-with-evidence | Commit parsing is implemented at the em-dash boundary by the phase-attribution matcher and its tests; the numeric anecdote adds no operative rule. |
| do-arc 12, terminal handoff landing mechanics | methodology | enforced-by-code(`roadmap arc land`; `cli/lib/landing.mjs`) with judgment summary kept | The 1658 ledger already dispositioned base-drift, contended-primary, detach, and journal mechanics to the guarded landing implementation; reintroduced narration is not a new judgment contract. |

### Evidence rule for every remaining row

`keep` means the row carries routing, sequencing, or judgment that no named command initiates by itself. `enforced-by-code` is valid only when its disposition names a command plus implementation/test path. `relocate` is valid only when the target contains the passage in spirit and the surviving body cites it at the firing point. Phase 26.3 may not act on the four generic `enforced-by-code(cli command and its command tests)` rows until it replaces each with a concrete command and path; otherwise the row defaults to `keep`.

### Derived projection and manifest treatment

The pre-diet do-arc manifest is 53,343 bytes, approximately 13,339 tokens at the repository estimator's four-bytes-per-token bridge. The original relocation rows remove 3,187 loaded bytes. The clause-level terminal-handoff mechanics remove approximately 3,500 more; executor incident/rationale clauses and other amended clause splits must contribute at least 1,315 measured bytes. Thus the actionable cut floor is 8,002 bytes (`53,343 × 15%`, rounded up), projecting no more than 45,341 loaded bytes or approximately 11,336 tokens. Phase 26.3 must replace estimates with `roadmap measure` output and ratchet the constant to that exact measured total; missing the floor is an escalation, not permission to invent cuts.

New `references/protocol-details.md` and `agents/references/*-details.md` files are **on-demand and off-manifest**: they contain branch-specific mechanics or incident provenance and are cited only at their trigger. Any reference needed on every standard flow is standard-path and must be added to the manifest, consuming its projected saving. The unchanged in-flow `using-zeroh-roadmap` body and existing references total 7,608 bytes and are included in the 53,343-byte baseline even though this phase does not map them.

## Baseline

Captured before any trim with `roadmap eval adherence --since 2026-08-31 --json`; the date returned phases 14–25, and the table below takes the last ten landed phases, 16–25, in phase order. These runs predate durable beacon/gate-report retention in this worktree, so absent retained artifacts score as failures rather than fabricated passes.

| phase | driver | score | failed checks |
|---:|---|---:|---|
| 16 | gpt-5.6-sol / codex | 0.583 | tripwires-ran, gate-rounds-carry-model, guard-mutation-proofs-quoted, curation-evidence, verify-complete-passed |
| 17 | gpt-5.6-sol / codex | 0.583 | tripwires-ran, gate-rounds-carry-model, guard-mutation-proofs-quoted, curation-evidence, verify-complete-passed |
| 18 | gpt-5.6-sol / codex | 0.583 | tripwires-ran, gate-rounds-carry-model, guard-mutation-proofs-quoted, curation-evidence, verify-complete-passed |
| 19 | gpt-5.6-sol / codex | 0.500 | tripwires-ran, one-commit-per-task, gate-rounds-carry-model, guard-mutation-proofs-quoted, curation-evidence, verify-complete-passed |
| 20 | gpt-5.6-sol / codex | 0.583 | tripwires-ran, gate-rounds-carry-model, guard-mutation-proofs-quoted, curation-evidence, verify-complete-passed |
| 21 | gpt-5.6-sol / codex | 0.500 | tripwires-ran, one-commit-per-task, gate-rounds-carry-model, guard-mutation-proofs-quoted, curation-evidence, verify-complete-passed |
| 22 | gpt-5.6-sol / codex | 0.500 | tripwires-ran, one-commit-per-task, gate-rounds-carry-model, guard-mutation-proofs-quoted, curation-evidence, verify-complete-passed |
| 23 | gpt-5.6-sol / codex | 0.583 | tripwires-ran, gate-rounds-carry-model, guard-mutation-proofs-quoted, curation-evidence, verify-complete-passed |
| 24 | gpt-5.6-sol / codex | 0.500 | tripwires-ran, one-commit-per-task, gate-rounds-carry-model, guard-mutation-proofs-quoted, curation-evidence, verify-complete-passed |
| 25 | gpt-5.6-sol / codex | 0.500 | tripwires-ran, one-commit-per-task, gate-rounds-carry-model, guard-mutation-proofs-quoted, curation-evidence, verify-complete-passed |

Per-driver mean: **gpt-5.6-sol / codex = 0.542 (n=10)**. No claude-opus-5 phase falls within the last-ten slice, so its historical mean is unrecorded; the trial reports that absence rather than inventing a comparison.
