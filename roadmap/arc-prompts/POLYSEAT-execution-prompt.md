# POLYSEAT — execution prompt

The arc's bar, rationale, and research basis. The `.arc.ts` and phase `source` fields cite
this file; nothing here is restated there. do-arc reads this before driving.

## The bar

One agent-agnostic protocol library, any capable model in any seat, attribution stamped by
machinery, measurement accumulating from ordinary work. The user's own words are the
acceptance criteria — see the `.arc.ts`. Claude is the incumbent harness, not a privileged
one: every "same protocol" claim ships with the command that would falsify it.

## Why this arc exists (evidence, 2026-08-23)

- The plugin already HAS the three layers of a model-comparison system — attribution schema
  (`plannedBy`, `executionResult.driver`, `judgeModel`), measurement (`eval-scorecard.mjs`
  drivers/planners/reviewers cells, N-floor 5, honest abstention), improvement loop
  (gauntlet + `eval propose`) — and the pipe between them is dry: mudarabah2 measured
  12/702 phases with driver attribution, 7/702 with plannedBy (715–719 silently blank),
  and ZERO `roadmap/arc-evals/*.eval.json`, so every scorecard family renders 0 cells.
- The codex run lane paraphrases do-phase instead of delivering it: architect escalation
  8 mentions in SKILL.md vs 0 in `buildPrompt`; `decisionRef`, `eval lesson`,
  guard-mutation-proof all absent. A Codex run under that briefing is a different
  experiment than a Claude run — the scorecard would blame the model for the briefing.
- The review lane (commit c952585) proved the fix shape: deliver the SKILL.md by path,
  override only disposition, pin the non-duplication with a test that greps the prompt for
  protocol-owned strings.

## Research digest

### Superpowers (github.com/obra/superpowers) — the multi-harness model the user pointed at
- ONE skill library, agent-agnostic ("any updates to skills must work across all of the
  coding agents we support"); distributed through each harness's NATIVE plugin system
  (Claude plugin, Codex marketplace, Cursor, Devin, Pi) — no runtime adapter layer, no
  central dispatch.
- Subagents: each harness's native capability; no cross-harness spawn protocol.
- Per-harness bootstrap injection (Pi injects `using-superpowers` at session start; noted
  hazard: a harness without a post-compaction hook loses the bootstrap in long sessions).
- Applied here: ship `.codex-plugin` beside `.claude-plugin` (in-house precedent: zeroh-sdd
  1.0.9 is already dual-harness in this marketplace); skills stay the single protocol; the
  detached launcher lane remains for delegation but stops being the only door into Codex.

### Codex CLI capability audit (codex-cli 0.144.5, this host, 2026-08-23)
- `multi_agent` feature: **stable, enabled** — native subagent spawning exists.
- `plugins` + marketplace: stable. `hooks`: stable. `skills`: present. MCP client AND
  server (`codex mcp-server`). `resume`/`fork`/profiles: yes.
- Sandbox: Codex's bubblewrap CANNOT run on this host (bwrap RTM_NEWADDR under
  `apparmor_restrict_unprivileged_userns=1`) — the detached lane's
  `--dangerously-bypass-approvals-and-sandbox` + isolated worktree remains the mitigation.

### Superpowers' shipped Codex integration (cloned at ~/superpowers, read 2026-08-23)
The authoritative reference — they shipped this, we copy the shape:
- **Codex surfaces plugin skills NATIVELY** — no session-start hook. Their
  `.codex-plugin/plugin.json` sets `"skills": "./skills/"` and an EMPTY `"hooks": {}`
  DELIBERATELY, to suppress Codex's `hooks/hooks.json` auto-discovery (the hooks are
  Claude-shaped). Their warning, verbatim: "A hook *system* is not a session-start
  *event*" — confirm the specific event exists before committing to a hook-based bootstrap.
- **Skills name actions, never tools** ("dispatch a subagent", "read a file"); a per-harness
  tool mapping (`skills/using-superpowers/references/codex-tools.md`) translates the action
  vocabulary; skill BODIES are never edited per harness. Our analog: skills spawn ROLES; the
  mapping says how each harness fulfills a role.
- **The bootstrap is the entire integration**: their always-active skill
  (`using-superpowers`) must reach the model each session. Ours is `using-zeroh-roadmap` —
  on Codex it rides native skill discovery, same as theirs.
- Codex multi-agent specifics from their tool mapping: `spawn_agent {fork_turns: "none"}`
  for clean-context children; role files under `~/.codex/agents/` attach via `agent_type`
  on **Codex 0.145+** (this host: 0.144.5 — one version short; probe, don't assume);
  `followup_task` resumes a child; V2 has no `close_agent`; never copy model names into
  `spawn_agent` without checking the live allowlist.
- **Version single-sourcing**: `.version-bump.json` lists every manifest + field; one bump
  script rewrites all. Distribution to the OpenAI marketplace is a deterministic fork-sync
  script (`scripts/sync-to-codex-plugin.sh`) with an anchored exclude list so other
  harnesses' dotdirs never leak into the shipped tree.
- Their port Definition of Done: bootstrap loads every session with NO per-session opt-in;
  an acceptance test in a clean session auto-triggers the right skill; installed through the
  harness's own mechanism, never by editing user files.

### Model facts
- **GPT-5.6 Sol** (`gpt-5.6-sol`): OpenAI flagship, released 2026-07-09; 1,050k context,
  128k max output; $4/M in, $20/M out; tiers Sol/Terra/Luna (+ Sol Ultra).
  Architect seat tier chain (user ruling, verbatim order): 1) Fable 2) Sol 5.6 3) Opus 5
  → registry ids `claude-fable-5` → `gpt-5.6-sol` → `claude-opus-5`.
- `claude -p --agents '<json>'` verified on this host: headless Claude with custom agent
  definitions — the child-CLI seat mechanism for cross-family seats.
- Grok: NOT installed on this host. Its registry entry stays empty until verified at
  registration. Nothing in this arc may assume grok capabilities in either direction.

### Gauntlet lessons that bind this arc (GAUNTLET-2026-08.md)
- "Looks better ≠ is better" — never install a rewrite (or rank a driver) on inspection;
  sealed-set blind trials are the only ranking instrument (deferred item E).
- Value concentrates in judgment-heavy seats; parity matters most at architect/judge seats.
- Guard the harness itself: per-condition isolation, non-null contestant checks.

## Shared-host rules

~5 concurrent AI sessions, 16 GB. Suites/builds through `capbuild`. The plugin's own test
suite has 3 KNOWN environmental failures on this host (2 × `/usr/bin/env: 'node'` under
sanitized test env in eval/derive tsx-bridge tests, 1 × `measure --flow do-arc --assert
12500` over budget) — pre-existing on clean tree, verified 2026-08-23. A phase gate must
not claim them; fixing them is fair game inside a phase if it touches those seams.

## Deferred (do not build)

Model gauntlet (E) · grok registry entry until verified · historical attribution backfill.
