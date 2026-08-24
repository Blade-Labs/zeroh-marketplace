import { definePhase } from '@/lib/roadmap/schema'

/**
 * POLYSEAT plane 4 of 4 — role bindings, protocol delivery, native distribution.
 *
 * The deep phase, three braided debts: (1) protocol spawn points become ROLES a
 * driver fills per verified capability (native → child-CLI → prompts/inline, all
 * recorded), with the architect role's cross-family tier chain ruled verbatim:
 * claude-fable-5 → gpt-5.6-sol → claude-opus-5; (2) the run lane finally
 * DELIVERS do-phase by path — buildPrompt's paraphrase measured 0/8 architect
 * rails, so a codex run is currently a different experiment than a claude run;
 * (3) manifests become GENERATED from one source with a drift ratchet —
 * measured drift today: .claude-plugin 0.32.0 vs cursor/copilot 0.16.1 vs
 * gemini 0.18.0, and .codex/INSTALL.md advertises a gauntlet-retired skill.
 *
 * Superpowers precedents bound in the execution prompt: codex surfaces plugin
 * skills natively (empty hooks {} suppresses auto-discovery — deliberate);
 * skills name actions never tools; .version-bump.json single-sources versions.
 */
export default definePhase({
  phase: 4,
  name: 'Role bindings + do-phase delivered by path + manifests generated from one source',
  status: 'in-progress',
  arcId: 'POLYSEAT',
  plannedBy: { model: 'claude-opus-5[1m]' },
  category: 'feature',
  kind: 'logic',
  source:
    'Arc POLYSEAT plane 4 — designRefs MULTI-DRIVER.md §1 Role bindings + §2 registry consumption; rationale + superpowers digest in roadmap/arc-prompts/POLYSEAT-execution-prompt.md.',
  priority: 'HIGH',
  dependsOn: [2, 3],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/roles.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/agents/software-architect.md',
    'plugins/zeroh-roadmap/skills/review-phase/SKILL.md',
    'plugins/zeroh-roadmap/scripts/emit-manifests.mjs',
    'plugins/zeroh-roadmap/.codex-plugin/plugin.json',
    'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/codex-tools.md',
    'plugins/zeroh-roadmap/MULTI-DRIVER.md',
    'plugins/zeroh-roadmap/DIET-LEDGER.md',
  ],
  stakeholderDemo:
    'Any registered model can fill any protocol role — the architect escalation actually fires Fable first from a Codex run and records who decided — while Codex installs the plugin natively and reads the very same skill files Claude does.',
  assumptions: [
    {
      claim:
        "buildPrompt still carries its own protocol body (the debt its header admits: 'that debt is unpaid').",
      verify:
        "grep -qF 'THE GATE IS YOURS TOO' plugins/zeroh-roadmap/cli/commands/codex.mjs",
      onFalse: 'ESCALATE',
    },
    {
      claim:
        'The two prose model-policy homes this phase reduces to pointers still exist (architect card + review-phase HOME).',
      verify:
        "bash -c \"grep -qF 'Model policy (this card is the single home)' plugins/zeroh-roadmap/agents/software-architect.md && grep -qF 'Model policy (the HOME statement' plugins/zeroh-roadmap/skills/review-phase/SKILL.md\"",
      onFalse: 'ESCALATE',
    },
    {
      claim:
        'The manifest drift is still live (claude 0.32.x vs cursor 0.16.1) — the ratchet has a real defect to fix, not a hypothetical.',
      verify:
        'grep -qF \'"version": "0.16.1"\' plugins/zeroh-roadmap/.cursor-plugin/plugin.json',
      onFalse: 'ESCALATE',
    },
    {
      claim: "The superpowers reference clone is readable at ~/superpowers (the .codex-plugin layout + version-bump map this phase copies).",
      verify: 'test -f /home/patrik/superpowers/.version-bump.json',
      onFalse: 'ESCALATE',
    },
  ],
  notes:
    "DESIGN (locked; architect risks 1-5 pre-empted): cli/lib/roles.mjs exports ROLES (frozen) — one entry per agents/*.md card plus the spawn-site audit the sub-gate enumerated (do-phase, plan-phase, plan-arc, arc-sweep ×3, release-sweep, validate-arc ×2, do-arc ×2, full-code-review, eval-arc). Entry: { id, agentCard, spawnSites, class: 'judge'|'builder', tierChain, inlineFallbackLegal }. class mechanizes review-phase's existing rule — a consumer's modelPolicy.judgeModel may override JUDGE-class roles only. TIER CHAINS (user ruling verbatim): software-architect ['claude-fable-5','gpt-5.6-sol','claude-opus-5']; every other role a 1-entry chain equal to today's behaviour (the generalize-forward vertical — per-role chains for the judge panel are the arc's named follow-up). Frontmatter model aliases STAY as the harness fail-safe (risk 1: cards cannot carry full model ids — arc-eval-judge's own pin note); each touched card gains the one-line alias-drift caveat. resolveRole(roleId, driverId) reads the phase-2 registry's roleCapabilities and returns { mode: 'native'|'child-cli'|'inline', model, substituted? } — the resolver drives the chain itself (risk 3: claude's --fallback-model is single-hop claude-family-only, verified, so it can never reach gpt-5.6-sol); every firing is recordable into executionResult.roles (phase 3's shape), and inline is a RECORDED mode (risk 5) so criterion any-model-full-protocol stays judgeable.\n\nFALLBACK FALSIFICATION (risk 4): rigor-preservation is proven by INJECTED unavailability — ROADMAP_ROLE_FORCE_UNAVAILABLE=<model-id> makes the resolver treat that tier as down; the test walks fable→sol and asserts the substitution record { from, to, reason } and unreduced prompt; the guard-mutation-proof discipline (red under the defect, not under a reverted fix).\n\nPROSE HOMES REDUCE TO POINTERS in the same commit as roles.mjs (architect same-commit obligation): software-architect.md §Model policy and review-phase's HOME statement each become a pointer to MULTI-DRIVER.md §1 + roles.mjs, with one DIET-LEDGER.md disposition row EACH — a trim without its ledger row is a gate failure per the ledger's own rail.\n\nRUN-LANE DELIVERY: buildPrompt becomes an envelope exactly like buildReviewPrompt — the path to skills/do-phase/SKILL.md, targets, and LANE OVERRIDES ONLY (worktree rules, resume rule, cross-repo, report contract, sentinel); the protocol body (per-task loop, commit grammar, gate ownership, transparency contract, architect escalation — which do-phase itself carries) is READ FROM THE SKILL. The codex.test.mjs duplication guard extends to the run lane: protocol-owned strings from do-phase/SKILL.md (e.g. 'PRIME RULE', 'transparencyReport', the commit grammar line) must appear in the SKILL and NOT in the generated prompt. This pays the debt the file header records and is criterion any-model-full-protocol's grep clause.\n\nNATIVE DISTRIBUTION (superpowers shape, verified from their shipped code): scripts/emit-manifests.mjs regenerates EVERY harness manifest from one source — version from plugins/zeroh-roadmap/package.json (single-sourcing map in the .version-bump.json style), skill list from `ls skills/` — covering .claude-plugin/plugin.json, .cursor-plugin/plugin.json, .copilot/plugin.yaml, gemini-extension.json, and the NEW .codex-plugin/plugin.json ({ skills: './skills/', hooks: {} } — the EMPTY hooks object is deliberate, copied from superpowers: codex surfaces skills natively and the empty object suppresses hooks.json auto-discovery of Claude-shaped hooks). .codex/INSTALL.md is regenerated or reduced to a pointer (it currently advertises the gauntlet-retired code-review skill and a wrong count). The RATCHET test fails when any manifest's version ≠ package.json or its skill list ≠ ls skills/ — 'never stuff on multiple places' made mechanical. Per-harness tool mapping rides skills/using-zeroh-roadmap/references/codex-tools.md (superpowers' exact layout): action vocabulary → codex tool names, multi_agent config note, the 0.145+ agent_type caveat, spawn_agent fork_turns guidance — content adapted from the superpowers reference but written for THIS plugin's roles.\n\nPARITY MEASURE (criterion no-claude-privilege's instrument): a test computes the byte set of protocol content delivered to a codex driver (envelope-referenced SKILL.md files) vs the claude skill load for the same mission and asserts equivalence within the envelope-overhead bound; measured, never asserted. PROTOCOL-SET RULE (review ruling 2026-08-23): the set is the mission's SKILL.md + its references/ tree; agents/*.md cards are harness-delivery context (measure-manifest's do-phase flow carries phase-executor.md + executor-reference.md as the Claude-spawn vehicle), excluded by name and printed — without this rule the identity assertion is false-red at HEAD-after-4.2 by construction.\n\nHOOKS CHANNEL PROBE (LOCKED 2026-08-23): the codex skill-surfacing channel is PROBED against the installed CLI and recorded with evidence in codex-tools.md (4.3) — the empty hooks {} manifest shape is copied only once the probe confirms manifest-channel discovery; absence or presence is never assumed.\n\nREVIEW RATIFICATIONS (Mode A, 2026-08-23): testMode tdd ratified on all four tasks — each authors its guard/test artifact first (roles.test, codex.test duplication guard, emit-manifests ratchet, parity test); doc/pointer steps ride the task commit. Shared-host capbuild rules are ENVELOPE material (verified absent from do-phase/SKILL.md), kept in 4.2's lane overrides.",
  tasks: [
    {
      id: '4.1',
      title: 'roles.mjs — the role table and the chain-driving resolver',
      problem:
        'Model policy lives in two prose homes covering one role each, spawn points have no inventory, and nothing can resolve a role against a driver\'s verified capabilities — so a non-Claude driver cannot lawfully fill the architect escalation at all.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/roles.mjs',
          description:
            "Author ROLES (frozen; entries per the notes' schema, spawnSites from the sub-gate audit) and resolveRole(roleId, driverId, { forceUnavailable }) driving the tier chain per the notes; unknown role/driver throws naming the known sets → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/roles.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/roles.test.mjs',
          description:
            "Pin: architect chain resolves fable-first; ROADMAP_ROLE_FORCE_UNAVAILABLE walks to gpt-5.6-sol with a substituted { from, to, reason } record; both tiers down → opus; all three down → a named UNJUDGED error, never a silent skip; judgeModel override applies to judge-class only (builder-class ignores it, asserted) → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/roles.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/agents/software-architect.md',
          description:
            'Reduce §Model policy to a pointer at MULTI-DRIVER.md §1 + roles.mjs, keep the frontmatter alias + the one-line alias-drift caveat; same for the review-phase HOME statement; one DIET-LEDGER.md disposition row each, same commit → verify: bash -c "grep -qF \'MULTI-DRIVER.md\' plugins/zeroh-roadmap/agents/software-architect.md && grep -qF \'MULTI-DRIVER.md\' plugins/zeroh-roadmap/skills/review-phase/SKILL.md"',
        },
        {
          file: 'plugins/zeroh-roadmap/MULTI-DRIVER.md',
          description:
            'Author §1 Role bindings (glossary line disambiguating role vs SEATS-dispatcher vs lane vs slot vs plane; the table contract; the chain; the recording rule) and §2 Driver registry (entry schema, verify/register contract) — the ONE doc both designRefs name → verify: bash -c "grep -qF \'§1\' plugins/zeroh-roadmap/MULTI-DRIVER.md && grep -qF \'§2\' plugins/zeroh-roadmap/MULTI-DRIVER.md"',
        },
      ],
      acceptanceCriteria: [
        'resolveRole walks the ruled chain with recorded substitution at full rigor, proven by the forced-unavailability falsification in the transparencyReport',
        'Both prose homes are pointers with DIET-LEDGER rows in the same commit; the tier chain exists in exactly one place',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/roles.mjs',
        'plugins/zeroh-roadmap/cli/lib/roles.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/drivers.mjs',
        'plugins/zeroh-roadmap/agents/software-architect.md',
        'plugins/zeroh-roadmap/skills/review-phase/SKILL.md',
        'plugins/zeroh-roadmap/MULTI-DRIVER.md',
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
      ],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone:
          "cli/lib/roles.mjs is new and is the ONE home for role bindings: frozen ROLES, one entry per agents/*.md card ({ id, agentCard, spawnSites, class, tierChain, inlineFallbackLegal }), with spawnSites carrying the audited spawn points (skills + cli/commands/gate.mjs, which is where quality-pass and code-reviewer are actually named). software-architect carries the ruled chain claude-fable-5 -> gpt-5.6-sol -> claude-opus-5; every other role carries a 1-entry chain equal to its card's frontmatter alias. resolveRole(roleId, driverId, opts) walks that chain itself, returning { role, model, mode } plus { substituted: { from, to, reason } } whenever the resolved tier is not the head; an exhausted chain throws RoleUnjudgedError naming the role and every tier tried. reachMode(driverId, driverEntry, runnerId, runnerEntry) is exported and pure: native (same driver declaring native subagents), child-cli (the runner declares headlessChild), inline (the driver fills the role itself), or null for a tier this driver cannot reach at all, which the walk treats as unavailable rather than pretending a model answered. cli/lib/drivers.mjs gained MODEL_IDS, MODEL_DRIVERS and driverForModel (routing only, explicitly not a capability claim) plus headlessChild on both entries, the codex one carrying an extended verifiedAt command and pasted `Usage: codex exec [OPTIONS] [PROMPT]` output. MULTI-DRIVER.md is new and holds the four-word glossary (role vs driver vs lane vs slot vs plane, with the SEATS dispatcher explicitly excluded), section 1 Role bindings and section 2 Driver registry. In the SAME commit, agents/software-architect.md's Model policy and skills/review-phase/SKILL.md's HOME statement became pointers at that doc, with five disposition rows in DIET-LEDGER.md.",
        how:
          "TDD: test-engineer wrote cli/lib/roles.test.mjs blind to the steps and it ran RED against the missing module (0 pass / 1 fail, ERR_TEST_FAILURE on the import), then GREEN 36/36 after implementation. Two contract decisions were re-derived during the GREEN pass and are recorded here rather than in a doc. FIRST: the fixture assumed a claude driver cannot reach the codex model and would therefore fill the architect role INLINE on gpt-5.6-sol. That pairing is incoherent (mode inline means the driver itself answers, so recording Sol as the model would be a false attribution) and the underlying premise is false — `codex exec` is a headless child mechanism this plugin's own run lane uses. Rather than record a capability as absent that is trivially verifiable, the probe was re-run verbatim and its output pasted into the codex entry, headlessChild landed on both entries, and the reach rule reads that key; the three reach tests were rewritten to pin all three arms of reachMode with a synthetic prompts-only entry. SECOND: with both registered drivers spawnable, an inline-only tier is unreachable in production, so the inlineFallbackLegal refusal was folded into the availability walk (skip with a named reason, exhaust to RoleUnjudgedError) instead of a separate throw that no registry state could reach; resolveRole takes drivers/modelDrivers as parameters so both the inline arm and that refusal are provable rather than merely written, and one test asserts no real role/driver pair resolves inline today. GUARD MUTATION PROOFS, three drives each. spawnSites-as-evidence: planted violation (quality-pass listing skills/plan-arc/SKILL.md, a file that never names it) RED on test 'every spawnSites path exists AND mentions the role id'; anchor drift (validate-arc/SKILL.md renamed in the entry) RED on the same test; decoy (code-reviewer gaining skills/using-zeroh-roadmap/SKILL.md, which does name it) GREEN 36/36. One-home: planted violation (the chain pasted back into the architect card as prose) RED on 'the tier chain has exactly ONE home'; anchor drift (the card's MULTI-DRIVER.md reference renamed) RED on the same test; decoy (a chain sentence carrying no model literal) GREEN 36/36. Alias drift: planted violation (code-reviewer frontmatter model: sonnet) RED on 'each card's frontmatter model alias and its chain HEAD are one decision'; anchor drift (the frontmatter key renamed to model_id) RED on the same test; decoy (an added user_callable line beside the alias) GREEN 36/36. Every mutation was reverted from pristine copies and `git diff` on the touched cards confirmed only the intended pointer reduction remained. Verified: `roadmap gate run 4 --slots types` GREEN (declared-none) and 85/85 across roles, drivers and driver suites under capbuild.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "Nothing CONSUMES resolveRole yet — no spawner calls it, so the recorded { role, model, via, substituted } bindings that executionResult.roles exists to hold are still written by hand; the resolver is proven correct, not proven wired. The registry-injection parameters on resolveRole have exactly one caller today (the fixture that pins the prompts-only branch), which is a testability seam and is documented as one. class is a deliberate extension of the review-phase HOME rule rather than a restatement of it: the HOME statement named three judge seams and three never-judge seams, and code-reviewer and arc-eval-judge are classed judge here on the same principle (a verdict on work the role did not produce) without any consumer's judgeModel routing changing today. driverForModel routes claude-sonnet-5 and claude-fable-5 with no per-model probe behind them — the claim is only that the claude binary would run them, and MODEL_DRIVERS says so in its docblock.",
      },
      done: true,
      doneDate: '2026-08-24',
    },
    {
      id: '4.2',
      title: 'The run lane delivers do-phase by path — the paraphrase debt is paid',
      problem:
        "buildPrompt restates do-phase with 0 of its 8 architect-escalation rails, no decisionRef rule and no eval-lesson capture — so a delegated run follows a thinner protocol than an inline one and the scorecard blames the model for the briefing.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs',
          description:
            "Replace buildPrompt's protocol body with an envelope in buildReviewPrompt's exact shape: resolved path to skills/do-phase/SKILL.md (+ its references/), targets, and lane-only overrides (worktree rules, resume rule, cross-repo, shared-host capbuild rules — absent from the SKILL — CODEX-REPORT contract, sentinel); role firings recorded into executionResult.roles per phase 3's shape; same commit: delete the header's 'that debt is unpaid' line and fix its stale 'Division of labor' paragraph (still claims the gate stays with the supervising session, contradicting GATE-IS-YOURS-TOO and do-phase SKILL.md) → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
          description:
            "Extend the duplication guard to the run lane: protocol-owned strings from do-phase/SKILL.md ('PRIME RULE', 'transparencyReport', the commit-grammar line) present in the SKILL and ABSENT from the generated prompt; falsify by pasting one back into the envelope and asserting the red → verify: capbuild node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs",
        },
      ],
      acceptanceCriteria: [
        'The run-lane prompt names the do-phase SKILL.md path and carries zero protocol-owned strings, guard falsified and recorded',
        'All pre-existing codex.test.mjs tests stay green (lane mechanics untouched)',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/codex.mjs',
        'plugins/zeroh-roadmap/cli/commands/codex.test.mjs',
      ],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone:
          "buildPrompt in cli/commands/codex.mjs is now an envelope in buildReviewPrompt's exact shape: a new RUN_SKILL constant resolves skills/do-phase/SKILL.md from this file (so a plugin move follows), the prompt hands that path over with 'YOUR PROTOCOL IS A FILE', points at the skill's references/ siblings, names the target phase files, and then carries LANE OVERRIDES ONLY — worktree fencing, the cross-repo instruction, the resume rule, the shared-host capbuild rules, the no-subagents disposition, the codex-lane attribution pair, and the CODEX-REPORT.md hand-off with its two sentinels. Everything the protocol owns is gone from the prompt: the per-task loop, the commit grammar, the transparency contract, the architect-escalation rails, the gate protocol, the curate step. Same commit, the header docblock was corrected on both counts the plan named: the 'that debt is unpaid' line now records that BOTH lanes deliver their mission's SKILL.md by path and that codex.test.mjs greps each generated prompt for its mission's owned strings, and the stale Division of labor paragraph (which still claimed the gate stays with the supervising session, contradicting do-phase/SKILL.md and the 2026-07-22 ruling) now states the driver runs each phase fully, gate included, with the session owning audit and integration.",
        how:
          "TDD. test-engineer extended cli/commands/codex.test.mjs blind to the implementation with four run-lane tests plus a DO_PHASE_OWNED list of twelve protocol-owned strings, each asserted PRESENT in the skill as a precondition before being asserted ABSENT from the prompt — so a reword in the skill reds as 're-anchor DO_PHASE_OWNED' instead of passing on nothing. RED before implementation: 24 pass / 3 fail (delivery, non-duplication and attribution failing; the fourth, 'the lane-only overrides SURVIVE the delivery', passing by design as the regression fence around what the rewrite must not drop). GREEN after: 27/27. GUARD MUTATION PROOF of the duplication guard, three drives. Planted violation: a '- Persist a transparencyReport per task.' line pasted back into the envelope -> RED on 'run: the do-phase protocol BODY stays in the skill' (26 pass / 1 fail). Anchor drift: 'PRIME RULE 1' reworded to 'PRIME DIRECTIVE 1' in skills/do-phase/SKILL.md -> RED, LOUDLY, with the named message 'precondition: skills/do-phase/SKILL.md must own \"PRIME RULE 1\" — it was reworded or removed there, so this guard would pass on nothing; re-anchor DO_PHASE_OWNED to the skill's current text'. Decoy: a near-protocol but genuinely lane-owned line ('- The gate is yours too in this lane: drive it yourself, to green.') -> GREEN 27/27. Both mutations were reverted from pristine copies and git diff confirmed SKILL.md clean and codex.mjs carrying only the intended envelope change. Verified: 143/143 across codex, gate, status, arc, roles and drivers suites under capbuild, and `roadmap gate run 4 --slots types` GREEN.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The guard is a string grep over the generated prompt, so it catches a RESTATED protocol only where the restatement reuses the skill's own vocabulary: a paraphrase that says the same thing in different words — exactly the failure this phase is paying off — would pass it. The twelve anchors were chosen as the load-bearing ones and each carries a precondition, but breadth is bounded by that choice. The prompt is verified as a STRING, not as a briefing that works: nothing here proves a real Codex run reads the SKILL it is handed, which is criterion any-model-full-protocol's job at validate-arc time, not this task's. The lane still carries the shared-host capbuild rules and the scripts/test/run-tier.sh path, which are this consumer's conventions rather than universal lane material; the test proves they are absent from the skill today and names the move if that changes.",
      },
      done: true,
      doneDate: '2026-08-24',
    },
    {
      id: '4.3',
      title: 'Manifests generated from one source, drift ratcheted dead',
      problem:
        'Five harness manifests are hand-maintained and have drifted to four different versions, with .codex/INSTALL.md advertising a retired skill — the parity claim rotting in advance, and the exact "stuff on multiple places" the operator banned.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/emit-manifests.mjs',
          description:
            "Author the generator: a .version-bump.json-style file map (superpowers' shipped pattern) driving version-from-package.json + skills-from-`ls skills/` into .claude-plugin/plugin.json, .cursor-plugin/plugin.json, .copilot/plugin.yaml, gemini-extension.json, and the NEW .codex-plugin/plugin.json ({ skills: './skills/', hooks: {} } — empty hooks DELIBERATE per the superpowers codex shape); regenerate .codex/INSTALL.md or reduce it to a pointer; run it once to fix the live drift → verify: capbuild node plugins/zeroh-roadmap/scripts/emit-manifests.mjs --check",
        },
        {
          file: 'plugins/zeroh-roadmap/scripts/emit-manifests.test.mjs',
          description:
            'The ratchet: --check exits 2 when any manifest version ≠ package.json or skill list ≠ ls skills/, naming the drifted file and field; wire it into the plugin npm test chain; falsify by hand-editing a scratch manifest version and asserting the named red → verify: capbuild node --test plugins/zeroh-roadmap/scripts/emit-manifests.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/codex-tools.md',
          description:
            "Author the per-harness tool mapping in superpowers' reference layout: action vocabulary → codex tool names, [features] multi_agent = true config note, spawn_agent fork_turns guidance, the ~/.codex/agents agent_type 0.145+ version caveat, and the roles-mapping rule (how a codex session fills judge-class roles via child-CLI claude -p); record the PROBED skill-surfacing channel (manifest skills key vs .codex/hooks.json) with codex version + pasted evidence — probed against the installed CLI, never assumed (LOCKED 2026-08-23; notes) → verify: grep -qF 'multi_agent' plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/codex-tools.md",
        },
      ],
      acceptanceCriteria: [
        'Every manifest carries package.json\'s version and the live skill list after one generator run — the measured drift (0.32.x/0.16.1/0.18.0) is gone',
        'The ratchet reds on a hand-edited manifest naming file and field, falsification recorded',
      ],
      files: [
        'plugins/zeroh-roadmap/scripts/emit-manifests.mjs',
        'plugins/zeroh-roadmap/scripts/emit-manifests.test.mjs',
        'plugins/zeroh-roadmap/.codex-plugin/plugin.json',
        'plugins/zeroh-roadmap/.codex/INSTALL.md',
        'plugins/zeroh-roadmap/.cursor-plugin/plugin.json',
        'plugins/zeroh-roadmap/.copilot/plugin.yaml',
        'plugins/zeroh-roadmap/gemini-extension.json',
        'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/codex-tools.md',
        'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/SKILL.md',
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
        '.agents/plugins/marketplace.json',
      ],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone:
          "scripts/emit-manifests.mjs is new: VERSION_TARGETS (the .version-bump.json idiom — five { path, field } entries covering .claude-plugin, .cursor-plugin, .codex-plugin, gemini-extension and the YAML .copilot manifest) and GENERATED_TARGETS (.codex-plugin/plugin.json and .codex/INSTALL.md, written whole). Version comes from package.json, the skill list from the directories under skills/, the agent list from agents/*.md. A version target is patched TEXTUALLY, so indentation, key order and every other byte survive a bump; a generated target is rendered. --check writes nothing and exits 2 naming each drifted file plus its field, or, for a generated file, the lines that differ. An unreadable source (missing package.json, missing or empty skills directory) exits 1 and writes nothing — an INSTALL.md advertising zero skills is worse than the drift it replaces. One run fixed the live drift: .cursor-plugin 0.16.1 and .copilot 0.16.1 and gemini-extension 0.18.0 all now carry package.json's 0.32.0, the new .codex-plugin/plugin.json carries skills './skills/' plus a present-and-empty hooks object, and .codex/INSTALL.md is regenerated from the live directories (it had advertised the retired code-review skill, omitted eval-arc, and counted 8 agents where 9 exist). test/version-parity.test.mjs was deleted: the ratchet's every-target version check is a strict superset of its two-file assertion, and keeping both would be the duplication this task exists to kill. skills/using-zeroh-roadmap/references/codex-tools.md is new — the action-to-codex-tool mapping, the multi_agent config note, spawn_agent fork_turns and the 0.145+ agent_type caveat, the role-fulfillment rule (how a Codex session reaches a claude-family role through a headless child), and the probed discovery evidence.",
        how:
          "TDD: test-engineer wrote scripts/emit-manifests.test.mjs blind to the implementation (15 tests, hermetic tmp fixture roots whose package version is 7.3.1 so a generator reading the real tree reds). RED was recorded by moving the just-written implementation aside and running the suite in the state the test was authored against: 0 pass / 1 fail, 'Cannot find module .../scripts/emit-manifests.mjs'. Honest sequencing note: the implementation was drafted before that run rather than after it, so the RED is a reproduction of the pre-implementation state, not a first-run. GREEN after restoring: 14/15, the single red being the live-tree ratchet, which is red BY CONSTRUCTION until the generator runs; after one run, 15/15 and `--check` exit 0. HOOKS-CHANNEL PROBE (LOCKED requirement — probed, never assumed), codex-cli 0.144.5 on host illumination: `codex plugin marketplace add /home/patrik/zeroh-marketplace` registered the repo, after which `codex plugin add zeroh-roadmap@zeroh-marketplace` failed with 'Error: plugin `zeroh-roadmap` was not found in marketplace `zeroh-marketplace`' — the discovery channel is the CODEX marketplace index at .agents/plugins/marketplace.json in the repo root, not the Claude-side .claude-plugin/marketplace.json. Adding the entry made the install succeed, and `codex debug prompt-input` (the model-visible prompt, no API call) then listed all 13 skills by name, description and file path, with zero hook mentions. Re-probed with .codex-plugin/plugin.json in place: still 13 skills, still zero hook mentions — the empty hooks object suppresses Claude-shaped hook discovery without costing surfacing. GUARD MUTATION PROOF of the ratchet, three drives on the REAL tree. Planted violation: .cursor-plugin/plugin.json hand-edited back to 0.16.1 -> --check exit 2, '- .cursor-plugin/plugin.json: version is 0.16.1, package.json says 0.32.0'. Anchor drift: gemini-extension.json renamed away -> exit 2, LOUDLY, '- gemini-extension.json: version — file missing'. Decoy: a legal non-version edit (.claude-plugin category changed) -> exit 0, no false red. All three reverted; git diff confirmed only the intended version patches remained. Verified: 88/88 across the emit-manifests, roles, codex and measure suites, `roadmap gate run 4 --slots types` GREEN, and `roadmap measure --flow do-arc` 13,256 <= the 13,257 ceiling.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "files[] gained seven entries the plan did not declare: the three drifted manifests the generator rewrites (.cursor-plugin/plugin.json, .copilot/plugin.yaml, gemini-extension.json), .codex/INSTALL.md, using-zeroh-roadmap/SKILL.md and DIET-LEDGER.md (the codex-tools.md pointer plus its funding row), the deletion of test/version-parity.test.mjs, and .agents/plugins/marketplace.json at the REPO root — which the probe showed is the actual discovery channel and which no plugin-internal generator can own, so its single entry is hand-landed and unratcheted. package.json was in the plan's files[] but needed no edit: it was already the version source at 0.32.0. The generator patches versions but does not BUMP them; `npm version` remains the bump, this is the propagation. The codex manifest mirrors author/repository/license/keywords from .claude-plugin/plugin.json, which stays their hand-owned home — one more place a human edits, though not one a version can rot in. The probe's footprint on the shared host was undone: both plugin installs, the marketplace registration and the 34 MB cache copy were removed, so a reader following the regenerated INSTALL.md re-adds the marketplace themselves. Nothing proves a codex session RUNS the protocol correctly — surfacing is proven, execution is criterion any-model-full-protocol's job at validate-arc.",
      },
      done: true,
      doneDate: '2026-08-24',
    },
    {
      id: '4.4',
      title: 'Protocol-load parity, measured — the anti-privilege instrument',
      problem:
        'Criterion no-claude-privilege demands MEASURED parity: without an instrument, "same protocol" is an assertion, and the confound (comparing briefings, not models) never reaches any output.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/roles.test.mjs',
          description:
            "Parity test: the do-phase PROTOCOL SET is skills/do-phase/SKILL.md + its references/ tree; agents/*.md cards are harness-delivery context, excluded by this named rule and printed as exclusions (rule + false-red rationale in notes). Compute the byte set the run-lane envelope references vs the claude-side set (measure-manifest do-phase flow filtered by the rule); assert protocol-set identity and bound the envelope overhead; a codex-only or claude-only file inside the set is a named failure → verify: capbuild node --test plugins/zeroh-roadmap/cli/lib/roles.test.mjs",
        },
      ],
      acceptanceCriteria: [
        'The parity test names any file present in one driver\'s protocol set and not the other, prints the agent-card exclusions with the classification rule, and passes at HEAD after 4.2',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/roles.test.mjs',
        'plugins/zeroh-roadmap/cli/commands/codex.mjs',
      ],
      testMode: 'tdd',
      transparencyReport: {
        whatWasDone:
          "cli/lib/roles.test.mjs gained the parity block: four tests that MEASURE, rather than assert, that a codex driver and a claude driver are handed the same protocol bytes for the do-phase mission. The codex side is derived from the text buildPrompt actually generates over a real tmp root — an envelope that stops naming its SKILL yields an empty set and reds — and the claude side from the committed cli/measure-manifest.json flow do-phase. Both are expanded by the named PROTOCOL SET RULE (a mission's SKILL.md plus every file under its references/ tree) and compared as sorted plugin-relative paths, with the difference in each direction printed by name on failure. The agents/*.md exclusions are PRINTED with the rule that excludes them, and a second test asserts the exclusion list is non-empty and contains only agents/ paths, so the rule can never quietly start dropping a skill file. A third test refuses a trivial set (exactly one mission skill, at least one references/ file, every member on disk). The fourth bounds envelope overhead against MAX_ENVELOPE_PROTOCOL_RATIO and prints the one-line command a reader runs to re-derive both numbers. cli/commands/codex.mjs exports buildPrompt and RUN_SKILL so the measurement reads the real generator rather than a copy of it.",
        how:
          "The instrument is the artifact, so the falsification is a mutation proof rather than a red-then-green: it is designed to PASS at HEAD after 4.2, which it does. MEASURED, printed by the run itself: envelopeBytes=3070, protocolBytes=16693, ratio=0.1839 against a bound of 0.22 — a bound chosen to sit between today's value and the pre-4.2 paraphrasing envelope's 3992/16693 = 0.239, so a lane that starts restating protocol reds while ~600 bytes of headroom stay available for genuine new overrides. Protocol set as measured: skills/do-phase/SKILL.md + skills/do-phase/references/guard-mutation-proof.md. Exclusions printed: agents/phase-executor.md, agents/references/executor-reference.md. GUARD MUTATION PROOF, three drives. Planted violation: buildPrompt's protocol line changed to name no path ('ask the supervising session') -> RED on 'codex and claude are handed the SAME protocol set' AND on the non-trivial-set test, 37 pass / 3 fail. Anchor drift: cli/measure-manifest.json's do-phase flow given a protocol file the lane never names (skills/plan-phase/SKILL.md) -> RED on the parity test naming the one-sided file, 39 pass / 1 fail. Decoy: a genuine new LANE override line added to the envelope -> GREEN 40/40, so legal envelope growth does not cry wolf. Both mutations reverted from pristine copies; git diff confirmed the manifest clean and codex.mjs carrying only the two exports plus one capitalisation. Verified: 40/40 in roles.test.mjs, 27/27 in codex.test.mjs after the export change.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "Parity is measured over the FILE SET and the envelope's byte ratio, not over what either driver does with it: identical bytes delivered is necessary, not sufficient, and criterion any-model-full-protocol still needs a real codex run at validate-arc time to close. The claude side is the committed manifest, not an observation of a live claude session — if the manifest under-describes what a phase-executor really loads, both sides are wrong together and the test still passes; the manifest's own missing-path exit-1 rail is what keeps it honest. The 0.22 bound has roughly 600 bytes of headroom, so a legitimately large new lane override will red it and force a deliberate re-ratchet rather than silently absorbing; that is the intended cost. The rule covers ONE mission (do-phase, the only mission the run lane delivers); a second delegated mission would need its own row, and nothing yet forces that.",
      },
      done: true,
      doneDate: '2026-08-24',
    },
  ],
})
