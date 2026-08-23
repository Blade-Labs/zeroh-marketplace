import { definePhase } from '@/lib/roadmap/schema'

/**
 * Graft measured trial — integration, footprint proof, before/after instrument.
 *
 * NanoNets/Graft (npm @nanonets/graft, 0.12.0 at plan time) builds a tree-sitter
 * repo map as linked markdown + a wiring.json code graph, queried via MCP/CLI with
 * NO resident daemon — on-demand refresh only. Its README claims (-32% cost, +60%
 * latency, SWE-bench 66% vs 54% warm-vs-cold) are ITS numbers; the gauntlet rule
 * binds here: never adopt on inspection, sealed measurement only
 * (roadmap/arc-prompts/POLYSEAT-execution-prompt.md, gauntlet lessons). This spike
 * delivers the integration + a pre-registered before/after protocol + the slicing
 * instrument over the phase-1 peval pipe. It delivers NO adoption verdict.
 *
 * Operator directive 2026-08-23 ("plan 1"): trial Graft, measured; steering
 * surface (item 2) is owned by the operator in ~/viki — out of scope here.
 * Fence: no Graft wiring in mudarabah2 or any other repo in this phase.
 *
 * timing: no reference data for band 4-6×surface:false
 */
export default definePhase({
  phase: 7,
  name: 'Graft measured trial — integration, footprint proof, before/after instrument',
  status: 'backlog',
  plannedBy: { model: 'claude-fable-5' },
  category: 'spike',
  kind: 'logic',
  source:
    'Operator directive 2026-08-23 (adopt-or-learn evaluation of Graft/codebase-memory-mcp/Orca; verdict: trial Graft measured, defer CBM, skip Orca). Measurement rides the POLYSEAT phase-1 peval pipe.',
  priority: 'LOW',
  dependsOn: [1],
  conflictsWith: [],
  keyFiles: [
    'package.json',
    '.gitignore',
    '.claude/skills/graft/SKILL.md',
    'scripts/graft-trial-report.mjs',
    'scripts/graft-trial-report.test.mjs',
    'roadmap/experiments/GRAFT-TRIAL.md',
  ],
  userFacing: false,
  stakeholderDemo:
    'A repo-map trial whose adoption call will come from measured phase records: install footprint proven safe for the shared host, and a report that compares before/after cohorts honestly, abstaining below the sample floor.',
  assumptions: [
    {
      claim:
        '@nanonets/graft is resolvable from the npm registry (plan-time probe 2026-08-23 observed latest = 0.12.0).',
      verify: 'npm view @nanonets/graft version',
      onFalse: 'ESCALATE',
    },
    {
      claim:
        'The phase-1 peval pipe has produced at least one record to slice (empty at plan time — phase 1 gate had not yet run; dependsOn [1] makes this an execution-time fact).',
      verify: 'bash -c "ls roadmap/arc-evals/phase-*.peval.json >/dev/null 2>&1"',
      onFalse: 'ESCALATE',
    },
    {
      claim:
        'No Graft wiring pre-exists in this repo (plan-time probe: graft/, .mcp.json, .claude/ all absent).',
      verify: 'bash -c "test ! -e graft && test ! -e .claude/skills/graft"',
      onFalse: 'ESCALATE',
    },
    {
      claim:
        'The scorecard helpers the instrument reuses are still exported (readPhaseEvalSamples, SCORECARD_N_FLOOR; bandFor/surfaceOf/spanMinutes live in eval-score.mjs).',
      verify:
        'bash -c "grep -qF \'export function readPhaseEvalSamples\' plugins/zeroh-roadmap/cli/lib/eval-collect.mjs && grep -qF \'export const SCORECARD_N_FLOOR\' plugins/zeroh-roadmap/cli/lib/eval-scorecard.mjs"',
      onFalse: 'ESCALATE',
    },
  ],
  notes:
    "PRE-MADE DECISIONS: (1) Install = exact-pinned devDependency at repo root ('@nanonets/graft': '0.12.0', no caret, no global install — shared host), invoked via npx; package-lock.json is committed with it (currently untracked from the tsx/zod install; folding it in makes the pin reproducible). (2) Structural build only is mandatory; the --deep LLM pass is gated on an ALREADY-PRESENT key (ANTHROPIC_API_KEY or OPENROUTER_API_KEY) — never provision one for it; observed vocabulary in the transparencyReport, one line exactly: deepPassVerdict=<ran|skipped-no-key|failed:reason> (angle-bracket form HERE deliberately, so the verify grep matches only a really-recorded verdict, never this plan text; 'failed:reason' is the honest escape when a key exists but the pass errors). (3) TRIAL DESIGN = before/after with cohort matching, not randomized A/B: baseline arm = peval records of phases whose gate ran before the 7.2 wiring commit (the POLYSEAT members), treatment arm = phases after; cut recorded as the 7.2 sha + phase number in the experiment doc. The ordering confound (learning effects, phase mix) is NAMED in the doc and mitigated by bandFor×surfaceOf cohort matching, never claimed eliminated. (4) Compared metrics come ONLY from PhaseEvalRecordShape: median spanMinutes(startedAt→completedAt), haltCount, gate slot durationMs, gate.green rate. Session token spend is NOT in the record and is named UNMEASURED in the doc — no cost claim can come out of this trial. (5) Decision bar pre-registered in the doc: adoption is proposed only if treatment median spanMinutes improves >=20% in >=1 cohort with N >= SCORECARD_N_FLOOR per arm AND green rate does not regress; below floor = extend, never rank. The spike itself renders NO verdict. (6) The report script REUSES plugin helpers (readPhaseEvalSamples, bandFor, surfaceOf, spanMinutes, SCORECARD_N_FLOOR) — a second metrics dialect is the drift this repo's singleSeam discipline exists to kill. (7) The root-level script test is NOT covered by the phase gate's unit slot (which runs only the plugin suite via 'cd plugins/zeroh-roadmap && capbuild npm test') — the step verifies carry it; acceptable for a spike, revisit if the script graduates into the plugin. (8) graft init review-before-commit: every file it writes is READ before staging; a hook making network calls or writing outside the repo is an ESCALATE, not a commit. userFacing false: developer tooling only, no product surface, no flag applies. NAMED RISK (review, 2026-08-23): this repo is a small mjs codebase — Graft's value proposition targets large-repo exploration, so the trial signal may stay under the N-floor or under-represent the effect; that outcome reads EXTEND-OR-MOVE (a larger consumer is a separate operator decision under the no-other-repos fence), never a negative verdict. REVIEW RATIFICATIONS (Mode A, 2026-08-23): testMode none on 7.1-7.3 ratified (install/wiring/doc tasks, no executable logic authored), tdd on 7.4 ratified; no testScope/reviewScope declared — diff-derived floors stand; userFacing false ratified with the rationale above.",
  tasks: [
    {
      id: '7.1',
      title: 'Pin Graft and build the structural graph under measurement',
      problem:
        "Adoption claims are README numbers; the first fact needed is what the build costs THIS host and THIS repo — RAM, wall-clock, disk — and whether anything stays resident afterward on a 16GB box that already banned tsserver.",
      steps: [
        {
          file: 'package.json',
          description:
            "Add devDependency '@nanonets/graft': '0.12.0' (exact pin — plan-time latest), npm install at root, commit package.json + package-lock.json together → verify: npx graft --version",
        },
        {
          file: '.gitignore',
          description:
            'Run capbuild /usr/bin/time -v npx graft build . — record Elapsed, Maximum resident set size, du -sh graft/, and post-run pgrep -fa graft (must be empty) VERBATIM in the transparencyReport; confirm graft/ is gitignored (no .gitignore exists at plan time — graft claims to auto-add; create the file with the graft/ line if it does not) → verify: bash -c "git check-ignore -q graft"',
        },
        {
          file: 'package.json',
          description:
            "Deep pass, key-gated: if ANTHROPIC_API_KEY or OPENROUTER_API_KEY is already set run npx graft build --deep and record cost/tokens; else record the skip — the transparencyReport carries one deepPassVerdict line per the notes vocabulary (decision 2), nothing else → verify: bash -c \"grep -qE 'deepPassVerdict=(ran|skipped-no-key|failed)' roadmap/phases/phase-7.phase.ts\"",
        },
      ],
      acceptanceCriteria: [
        'Exact pin committed with lockfile; build Elapsed/MaxRSS/on-disk size recorded verbatim; pgrep shows zero graft processes after the build; graft/ is ignored, never committed',
      ],
      files: ['package.json', 'package-lock.json', '.gitignore'],
      testMode: 'none',
      done: false,
    },
    {
      id: '7.2',
      title: 'graft init — wiring reviewed before committed',
      problem:
        'init writes third-party hooks, a skill file, and MCP registration into a shared repo; unreviewed hook shell in .claude/ is a supply-chain and shared-host hazard.',
      steps: [
        {
          file: '.claude/skills/graft/SKILL.md',
          description:
            'Run npx graft init; READ every file git status --porcelain reports before staging any (skill body, each hook script, MCP registration); a hook that makes network calls or touches paths outside this repo → ESCALATE, never commit; commit the reviewed set with explicit paths and list it in the 7.3 doc → verify: bash -c "test -f .claude/skills/graft/SKILL.md"',
        },
        {
          file: '.claude/skills/graft/SKILL.md',
          description:
            'Post-wiring liveness probe: one real query (graft ask or the MCP graft_find_code tool), then confirm nothing stayed resident → verify: bash -c "! pgrep -f graft >/dev/null"',
        },
      ],
      acceptanceCriteria: [
        'Every file graft init wrote is named and was read before commit; the skill file exists; a real query works; zero resident graft processes after the query',
      ],
      files: ['.claude/skills/graft/SKILL.md', '.mcp.json'],
      testMode: 'none',
      done: false,
    },
    {
      id: '7.3',
      title: 'GRAFT-TRIAL.md — pre-registered arms, confounds, decision bar',
      problem:
        "Without a pre-registered protocol the trial decays into adopt-on-inspection — the gauntlet's named failure mode ('looks better != is better').",
      steps: [
        {
          file: 'roadmap/experiments/GRAFT-TRIAL.md',
          description:
            'Author the protocol per notes decisions 3-5: arms + cut (7.2 sha and phase number), cohort keys (bandFor×surfaceOf), compared metrics, token-spend named UNMEASURED, ordering confound named, the >=20%-spanMinutes-at-N>=5-without-green-regression decision bar, footprint numbers pasted from 7.1/7.2, and the sentence that this phase renders no verdict → verify: bash -c "grep -qF \'decision bar\' roadmap/experiments/GRAFT-TRIAL.md"',
        },
      ],
      acceptanceCriteria: [
        'The doc pre-registers arms, cut, metrics, the unmeasured axis, the confound, and the bar — and states the spike delivers no adoption verdict',
      ],
      files: ['roadmap/experiments/GRAFT-TRIAL.md'],
      testMode: 'none',
      done: false,
    },
    {
      id: '7.4',
      title: 'graft-trial-report.mjs — the slicing instrument over peval records',
      problem:
        'The comparison must come from the same helpers the scorecard trusts, or the trial invents a second metrics dialect the singleSeam discipline forbids.',
      steps: [
        {
          file: 'scripts/graft-trial-report.test.mjs',
          description:
            'node:test fixtures over a tmpdir of synthetic phase-<N>.peval.json: split-at-cut lands each record in the right arm; a cohort-arm below SCORECARD_N_FLOOR prints ABSTAIN(n=<k>) and no numbers; a malformed record fails LOUD naming the file (no swallow) → verify: node --test scripts/graft-trial-report.test.mjs',
        },
        {
          file: 'scripts/graft-trial-report.mjs',
          description:
            'Implement against the tests: import readPhaseEvalSamples (eval-collect.mjs), bandFor/surfaceOf/spanMinutes (eval-score.mjs), SCORECARD_N_FLOOR (eval-scorecard.mjs); arg --cut <phaseNumber> (phase <= cut → baseline, > cut → treatment); per bandFor×surfaceOf cohort print {arm, n, median spanMinutes, haltCount, green rate} or ABSTAIN → verify: node --test scripts/graft-trial-report.test.mjs',
        },
        {
          file: 'scripts/graft-trial-report.mjs',
          description:
            'Smoke against the live roadmap/arc-evals: expected today all-baseline, treatment empty → every treatment cell ABSTAIN; paste the output in the transparencyReport → verify: node scripts/graft-trial-report.mjs --cut 7',
        },
      ],
      acceptanceCriteria: [
        'Tests pin split, abstention, and loud-failure; the live smoke run exits 0 with treatment fully abstaining; zero metric math duplicated from the plugin',
      ],
      files: ['scripts/graft-trial-report.mjs', 'scripts/graft-trial-report.test.mjs'],
      testMode: 'tdd',
      done: false,
    },
  ],
})
