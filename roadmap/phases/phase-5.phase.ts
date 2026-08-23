import { definePhase } from '@/lib/roadmap/schema'

/**
 * The handoff skill — session continuity for work that has not yet
 * crystallized into phases.
 *
 * Operator ruling 2026-08-23: the IDEAL handoff is the typed artifacts —
 * "write all context inside an arc/phases and simply say do arc / do phase in
 * a fresh session." The skill is a ROUTER honoring that: route context INTO
 * phase notes / assumptions / arc decisions / the vault / `roadmap eval
 * lesson` FIRST; only the residue with no typed home lands in
 * `.building/HANDOFF.md`; the last output is the one-line prompt for the
 * fresh session, pointing at the right door.
 *
 * Evidence base (2026-08-23 survey): three real hand-written handoffs found —
 * /tmp/PROMPT-710-711.md (phases existed → file collapsed to invocation +
 * scope fence + release intent), /tmp/RESUME-702-703.md (mid-flight state
 * with shas; hand-invented "supersedes all earlier versions" discipline),
 * mudarabah2/.building/PHASE-713-HANDOFF.md + NEXT-SESSION-PROMPT.md — four
 * names, two locations (/tmp is per-box and died with the box migration).
 * The agreed-place problem is real and measured.
 */
export default definePhase({
  phase: 5,
  name: 'Handoff skill — route context into phases first, residue to .building/HANDOFF.md',
  status: 'backlog',
  plannedBy: { model: 'claude-opus-5[1m]' },
  category: 'feature',
  kind: 'logic',
  source:
    'Operator request 2026-08-23 ("one thing I always ask for"): mechanize the session-handoff file + one-line execution prompt; shape ratified in-session (router model, .building/ home, skill-only no CLI verb). Standalone phase — deliberately NOT POLYSEAT (its gate is ratified and queued).',
  priority: 'MEDIUM',
  dependsOn: [4],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/skills/handoff/SKILL.md',
    'plugins/zeroh-roadmap/skills/handoff/references/template.md',
    'plugins/zeroh-roadmap/skills/handoff/evals/evals.json',
    'plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md',
  ],
  stakeholderDemo:
    'Ending a session is one skill call that files everything durable into the plan artifacts and leaves at most a small residue file — and starting the next session is one constant line, in any fresh window, on any model.',
  assumptions: [
    {
      claim:
        'No handoff/session-continuity skill exists in the plugin yet (the pattern lives only as hand-written files).',
      verify: 'bash -c "! test -d plugins/zeroh-roadmap/skills/handoff"',
      onFalse: 'ESCALATE',
    },
    {
      claim:
        "The manifest generator + ratchet from POLYSEAT phase 4 exist, so adding a skill directory must ride a regeneration or it reds the suite.",
      verify: 'test -f plugins/zeroh-roadmap/scripts/emit-manifests.mjs',
      onFalse: 'ESCALATE',
    },
    {
      claim:
        'The authoring standard is at v2 with PASS/FAIL rules the review task scores against.',
      verify:
        "grep -qF 'Skill Authoring Standard (SKILL.md Quality Bar) v2' plugins/zeroh-roadmap/SKILL-AUTHORING-STANDARD.md",
      onFalse: 'ESCALATE',
    },
  ],
  notes:
    "DESIGN (ratified in-session 2026-08-23, all decisions pre-made — implement, do not re-decide):\n\nTHE ROUTER PROTOCOL (the skill's core): at session end, for each candidate context item ask where it durably belongs and ROUTE IT THERE FIRST — design reasoning & learned code-facts → the phase's `notes`; new tripwires → `assumptions`; rulings → the arc's LOCKED DECISIONS; durable cross-project facts → the operator's vault (if bound); durable lessons → `roadmap eval lesson`. Committing phase-file edits IS the handoff. Only the measured residue classes land in .building/HANDOFF.md: scope fences · cross-phase intent (e.g. release framing) · mid-flight uncommitted state with shas + live background tasks + artifact URLs · unclear-awaiting-whom · ephemeral gotchas. Each residue line records WHY it was not routable — the self-liquidating property: the better the phases, the emptier the file.\n\nTHE ONE-LINER is the skill's final output, pointing at the right door: pure `do arc <ID>` / `do phase <N>`; hybrid `Read .building/HANDOFF.md (the fence), then do phase <N>`; pre-phase `Read .building/HANDOFF.md and continue from Next.` An agreed place makes the pickup line a CONSTANT — that is the whole win; pickup needs no skill.\n\nFILE CONTRACT: .building/HANDOFF.md, never committed (.building/ is the agreed untracked scratch home in every consumer — codex journals, arm files, driver provenance). Header carries freshness anchors: writtenAt · HEAD sha · 'supersedes previous' (the RESUME-702-703 discipline, mechanized); the template instructs the fresh session to run `git log --oneline <sha>..HEAD` and trust the repo over the file when they diverge. `--name <slug>` variant → .building/handoff-<slug>.md for parallel sessions on one repo; the default file lists siblings. PHASE-IN-FLIGHT REFUSAL: when `roadmap status` / the phase file already carry doing/state/next, the skill says so and refuses to duplicate them — the handoff exists ONLY for what has not crystallized.\n\nSKILL-ONLY, NO CLI VERB (ratified): routing is judgment (the skill half of the plugin's split); the mechanical bits (anchors, staleness diff) are three instructed lines — no TREE row, no protocol-load growth until proven needed.\n\nDEGREES OF FREEDOM (per the Anthropic best-practices doc, fetched 2026-08-23): routing decisions = high freedom (judgment checklist); the residue file format = strict template (references/template.md); the freshness check = low freedom (exact command, do not vary). EVAL-FIRST (the doc's 'Build evaluations first'): task 5.1 authors the three evaluation scenarios BEFORE the skill body — pure-phase (expect: routes everything, file near-empty, one-liner `do phase N`), hybrid (expect: fence + intent in file, hybrid one-liner), pre-phase freeform (expect: full residue file) — in the doc's evaluation JSON structure (skills/query/files/expected_behavior).\n\nREVIEW TASK 5.3 (operator-requested): score the FINISHED skill against BOTH bars — the Anthropic best-practices checklist (description third-person + triggers; body <500 lines; references one level deep; no time-sensitive info; consistent terminology — pick 'handoff' and never 'resume/prompt file'; concrete examples; workflow with checklist; feedback loop) AND the plugin's SKILL-AUTHORING-STANDARD v2 (every rule PASS/FAIL/N-A, delta-only paragraphs per R1). Name/description constraints: lowercase-hyphen ≤64 chars; description ≤1024 chars, third person, what + when with trigger terms (handoff, hand off, fresh session, continue in new session, context file, one-line prompt).\n\nMANIFEST INTERPLAY: phase 4's ratchet asserts manifest skill lists == ls skills/ — adding skills/handoff/ REDS the suite until scripts/emit-manifests.mjs regenerates; 5.4 runs it in the same commit as the skill directory (dependsOn [4]).\n\nREVIEW RATIFICATIONS (Mode A, 2026-08-23): R20 provenance rule — the skill's evidence-of-use line cites the 2026-08-23 survey by date + this phase's commit, NEVER the historical handoff filenames (5.3's terminology probe bans those tokens deliberately; consumer-repo paths would also break R21 portability). testMode 'none' ratified on all four tasks — every artifact is declarative (markdown/JSON/regenerated manifests); the guards are the step-level grep/node verifies plus phase 4's manifest ratchet, per the declarative-artifact rule (ratchet/lint lane, not bespoke tests). kind 'logic' accepted — the enum (mockup|logic|hardening|release) has no docs kind. The 5.2 <200-line cap is SKILL-AUTHORING-STANDARD R7's workflow cap, the DELIBERATE tighter of the two bars (the Anthropic doc's <500 is the looser; both must pass, the tighter binds — not drift). Assumption 2 fails at plan time BY DESIGN: it is the execution-time tripwire proving dependsOn [4] actually delivered scripts/emit-manifests.mjs before 5.4 leans on it.",
  tasks: [
    {
      id: '5.1',
      title: 'Evaluations first — three scenarios with expected routing behaviour',
      problem:
        "The best-practices doc is explicit: build evaluations BEFORE writing extensive documentation, so the skill solves the three measured cases (PROMPT-710-711's pure-phase collapse, RESUME-702-703's mid-flight state, the freeform NEXT-SESSION case) rather than imagined ones.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/handoff/evals/evals.json',
          description:
            "Author the three scenarios ({skills, query, files, expected_behavior} per the doc's structure) mapping 1:1 to the notes' EVAL-FIRST cases: phases-exist, hybrid mid-arc, pre-phase freeform; each expected_behavior names routing destinations → verify: node -e \"const e=require('./plugins/zeroh-roadmap/skills/handoff/evals/evals.json'); process.exit(e.length===3 && e.every(x=>Array.isArray(x.expected_behavior)&&x.expected_behavior.length>=3)?0:1)\"",
        },
      ],
      acceptanceCriteria: [
        'Three evaluation scenarios exist, each with ≥3 expected behaviours naming routing destinations',
        'The scenarios map 1:1 to the three measured hand-written precedents from the 2026-08-23 survey',
      ],
      files: ['plugins/zeroh-roadmap/skills/handoff/evals/evals.json'],
      testMode: 'none',
      done: false,
    },
    {
      id: '5.2',
      title: 'The skill body and template — router protocol, residue contract, constant one-liner',
      problem:
        'The pattern exists only as four differently-named hand-written files in two locations, one of which (/tmp) died with the box migration. The skill mechanizes the routing judgment and fixes the agreed place.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/handoff/SKILL.md',
          description:
            "Author per the notes' design: frontmatter (name 'handoff'; third-person description with trigger terms, ≤1024 chars); body = the routing checklist (destinations table with the copy-progress checklist pattern), the residue classes with why-not-routable discipline, the phase-in-flight refusal, the one-liner emission rule (three doors), --name variant, freshness-anchor writing; template by reference one level deep. Consistent terminology: 'handoff' only; R20 provenance per the notes' ratification block → verify: bash -c \"head -8 plugins/zeroh-roadmap/skills/handoff/SKILL.md | grep -qE '^name: *\\\"?handoff' && test $(wc -l < plugins/zeroh-roadmap/skills/handoff/SKILL.md) -lt 200\"",
        },
        {
          file: 'plugins/zeroh-roadmap/skills/handoff/references/template.md',
          description:
            'The strict residue-file template: header line (mission · writtenAt · HEAD <sha> · supersedes previous), sections Invocation / Fence / State (shas, background tasks, artifact URLs) / Unclear (awaiting whom) / Residue (item + why-not-routable each) / Siblings; plus the exact low-freedom pickup staleness command (`git log --oneline <sha>..HEAD` — trust the repo over the file) → verify: grep -qF "supersedes previous" plugins/zeroh-roadmap/skills/handoff/references/template.md',
        },
      ],
      acceptanceCriteria: [
        'SKILL.md body under 200 lines with the template one reference-level deep, routing table present, all three one-liner doors named',
        'Running the skill against eval scenario 1 mentally satisfies its expected_behavior: durable items route to phase artifacts, not the file',
      ],
      files: [
        'plugins/zeroh-roadmap/skills/handoff/SKILL.md',
        'plugins/zeroh-roadmap/skills/handoff/references/template.md',
      ],
      testMode: 'none',
      done: false,
    },
    {
      id: '5.3',
      title: 'Score the finished skill against both authoring bars, fix what fails',
      problem:
        'The operator explicitly requested the final skill be reviewed against the Anthropic best-practices doc; the gauntlet standard additionally binds every new plugin skill ("must pass it"). An unscored skill is an unshipped one.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/skills/handoff/SKILL.md',
          description:
            "Score rule-by-rule against (a) SKILL-AUTHORING-STANDARD.md v2 (every rule PASS/FAIL/N-A, scoring computed) and (b) the Anthropic checklist enumerated in the notes' REVIEW TASK 5.3 block; FIX every FAIL in place; full scorecard into the transparencyReport → verify: bash -c \"grep -qE 'name: *\\\"?handoff' plugins/zeroh-roadmap/skills/handoff/SKILL.md && ! grep -riE 'resume file|prompt file|next-session' plugins/zeroh-roadmap/skills/handoff/SKILL.md plugins/zeroh-roadmap/skills/handoff/references/template.md\" (evals.json deliberately excluded — scenario text may quote the historical filenames it mechanizes away)",
        },
      ],
      acceptanceCriteria: [
        'Both scorecards recorded in the transparencyReport with zero unfixed FAILs',
        "Terminology probe passes: the skill never calls the artifact anything but 'handoff'",
      ],
      files: ['plugins/zeroh-roadmap/skills/handoff/SKILL.md'],
      testMode: 'none',
      done: false,
    },
    {
      id: '5.4',
      title: 'Manifests regenerated — the new skill ships to every harness',
      problem:
        "Phase 4's ratchet asserts every manifest's skill list equals ls skills/ — adding skills/handoff/ without regenerating reds the plugin suite, and NOT shipping it to codex/cursor/gemini would re-open the no-claude-privilege gap for this skill.",
      steps: [
        {
          file: 'plugins/zeroh-roadmap/scripts/emit-manifests.mjs',
          description:
            'Run the generator (no edits to it); commit the regenerated manifests in the same commit as the skill directory; the ratchet in the plugin suite is the proof → verify: capbuild node plugins/zeroh-roadmap/scripts/emit-manifests.mjs --check',
        },
      ],
      acceptanceCriteria: [
        "Every harness manifest lists 'handoff' and the plugin suite's manifest ratchet is green",
      ],
      files: [
        'plugins/zeroh-roadmap/.codex-plugin/plugin.json',
        'plugins/zeroh-roadmap/.claude-plugin/plugin.json',
        'plugins/zeroh-roadmap/.cursor-plugin/plugin.json',
        'plugins/zeroh-roadmap/.copilot/plugin.yaml',
        'plugins/zeroh-roadmap/gemini-extension.json',
      ],
      testMode: 'none',
      done: false,
    },
  ],
})
