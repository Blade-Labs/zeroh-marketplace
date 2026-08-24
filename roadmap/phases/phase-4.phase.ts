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
        'plugins/zeroh-roadmap/agents/software-architect.md',
        'plugins/zeroh-roadmap/skills/review-phase/SKILL.md',
        'plugins/zeroh-roadmap/MULTI-DRIVER.md',
        'plugins/zeroh-roadmap/DIET-LEDGER.md',
      ],
      testMode: 'tdd',
      done: false,
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
      done: false,
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
        'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/codex-tools.md',
        'plugins/zeroh-roadmap/package.json',
      ],
      testMode: 'tdd',
      done: false,
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
      files: ['plugins/zeroh-roadmap/cli/lib/roles.test.mjs'],
      testMode: 'tdd',
      done: false,
    },
  ],
})
