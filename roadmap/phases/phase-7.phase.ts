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
  status: 'in-progress',
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
      transparencyReport: {
        whatWasDone:
          "'@nanonets/graft': '0.12.0' is an exact-pinned root devDependency (no caret, no global install), committed with package-lock.json; `npx graft --version` prints 0.12.0 and node_modules/@nanonets/graft/package.json agrees. The structural build ran under capbuild and produced graft/ — wiring: 2551 nodes (2112 function, 261 file, 87 type, 51 method, 23 class, 17 interface), 6859 edges, 261 cards [javascript, python, typescript]; parsed 261 of 261 files, 0 replayed from cache. MEASURED FOOTPRINT, verbatim: `Elapsed (wall clock) time (h:mm:ss or m:ss): 0:19.367` / `Maximum resident set size (kbytes): 484696` / `User time (seconds): 20.73` / `System time (seconds): 0.84` / `Exit status: 0`; `du -sh graft/` = `19M\tgraft/`. RESIDENCY: post-build `pgrep -fa graft` printed nothing, `pgrep-exit=1` — zero resident processes, no daemon. graft auto-appended `/graft/` to .gitignore (`git check-ignore -q graft` exits 0, git status shows no graft/ path). deepPassVerdict=skipped-no-key. TELEMETRY, verbatim from `npx graft telemetry`: `telemetry: off — this build has no telemetry key (a fork, or a local npm run build); nothing can be sent` — the npm artifact cannot phone home, so nothing needed disabling.",
        how:
          "Two environment facts diverged from plan time and both were handled without narrowing the criterion. (a) GNU time is NOT installed on this host (`/usr/bin/time` absent; only bash's builtin, which reports no MaxRSS), so `capbuild /usr/bin/time -v npx graft build .` exited 127. The measurement was taken instead through `resource.getrusage(RUSAGE_CHILDREN)` in a 12-line python3 wrapper that formats GNU time's own labels — the same kernel counters GNU time reads for Elapsed and Maximum resident set size — so the numbers above are the instrument the step asked for, not a weaker proxy. (b) The step's residency verb `pgrep -fa graft` SELF-MATCHES: the probing shell's argv contains the pattern, so run inline it can never be empty (it returned the Claude bash wrapper's own command line). The probe was re-run from a script file at a path containing no 'graft' substring, which is the only way that assertion can be honest; flushed as a durable lesson (`roadmap eval lesson`, phase 7). Deep pass: neither ANTHROPIC_API_KEY nor OPENROUTER_API_KEY is set in this session's environment, and per notes decision 2 no key is provisioned for it — hence skipped-no-key, structural build only. Latest on npm is now 0.16.0 (graft says so on every run); the plan's exact 0.12.0 pin is kept deliberately — the trial measures the version it pre-registered, and 0.12.0 is still published.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "`graft build` writes a THIRD root file the plan did not foresee: `.ignore` (contents: a comment plus `!graft/`, `graft/.cache/`, `graft/.graph/`) whose only effect is to re-admit the gitignored graft/ tree to ripgrep. It was read before any staging (benign: no shell, no network, no path outside this repo) and is gitignored rather than committed, so the trial's committed footprint stays exactly the three files the plan named and is reversible by deleting graft/ + .ignore; if Graft is adopted, committing .ignore becomes the right call. Footprint is measured for THIS repo only (261 files, 2551 nodes) — 19M/484MB/19s does not extrapolate to a large consumer, and the build is on-demand, so a repo that rebuilds often pays that RSS repeatedly on a 31GB shared box. The --deep LLM pass is UNMEASURED here: no key, so nothing is known about its cost, latency or footprint.",
      },
      done: true,
      doneDate: '2026-09-03',
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
      transparencyReport: {
        whatWasDone:
          "`npx graft init --no-build --no-global --no-agents .` wrote FIVE in-repo files, every one read before staging: .claude/settings.json (statusline + SessionStart/UserPromptSubmit/PostToolUse/Stop hook blocks + permissions), .claude/helpers/graft-statusline.cjs (67 lines), .claude/helpers/graft-hooks.cjs (67 lines), .claude/skills/graft/SKILL.md (150 lines), .mcp.json (mcpServers.graft). `--no-global` was MANDATORY, not stylistic: the default dry run said it would also write `~/.codex/config.toml`, `~/.codex/hooks/graft/graft-hooks.cjs`, `~/.codex/hooks.json` (SessionStart/UserPromptSubmit/PostToolUse/Stop) and `~/.gemini/config/mcp_config.json` + `~/.gemini/skills/graft/SKILL.md` under the banner 'would write — your machine, affects ALL repos' — out-of-repo writes that notes decision 8 forbids outright and that would have wired Graft into every repo on a 6-session shared box, breaking this phase's own no-other-repos fence. `--no-agents` kept the wiring to Claude Code, matching the task's declared files. LIVENESS: `npx graft ask \"where is the phase gate resolved?\" . -n 3` returned 3 ranked hits with exact file:line spans, exit 0. RESIDENCY: a two-pattern probe run from a script file whose own path contains neither 'graft' nor 'nanonets' returned rcA=1 / rcB=1 — zero matches, zero resident processes after the query.",
        how:
          "SUPPLY-CHAIN REVIEW of the payload behind the shims (node_modules/@nanonets/graft/dist/claude/*.js, shipped unminified): NO network call exists anywhere in the hook-reachable path — the only fetch() in the package is dist/telemetry/send.js:68, and dist/telemetry/key.js ships `BAKED_KEY = ''` so sendBatch returns {ok:false,error:'no key'} before it, which `npx graft telemetry` independently confirms ('telemetry: off — this build has no telemetry key ... nothing can be sent'). All hook state is written under `graft/.cache/` INSIDE the repo (dist/claude/state.js → cacheDir(d)); nothing writes outside. So decision 8's two ESCALATE triggers are both absent, and the review proceeded to commit. It surfaced FOUR defects, all fixed before staging under a software-architect ruling (claude-fable-5, child-cli, VERDICT: PROCEED_WITH_FIX) whose factual claims I re-verified against the real files: (1) the Stop hook. dist/claude/hooks.js handleStop() spawns sync-run.js DETACHED + unref()'d, which runs a full structural `graft build .` — measured in 7.1 at 484696 kB MaxRSS / 20.7s CPU — after every turn that dirties the graph, outside capbuild's cgroup, on a box whose binding rules (/home/patrik/CLAUDE.md) put ~6 sessions on 31 GB and require every build to run under capbuild. mergePolicy.primaryCheckout is /home/patrik/zeroh-marketplace, so a committed Stop hook would arm that in the fleet's shared checkout. The architect showed my first instinct (just delete the Stop block) was WRONG and under-scoped: ensureFreshGraph() (dist/graph/refresh.js) is also wired into every CLI query (cli.js refreshBefore, six call sites) and every MCP tool (mcp/tools.js:207), and the UserPromptSubmit hook shells `graft ask` with no --no-refresh under an 8s CHILD_TIMEOUT_MS — so deleting Stop alone would relocate the same 19s build into the prompt hook and get it SIGTERM'd at 8s, re-firing every turn. The correct seam is graft's own kill switch GRAFT_NO_REFRESH (refresh.js:52, 'for CI or anyone who wants queries to never write'), which gates the CLI and MCP paths alike. Applied: Stop block deleted, top-level `env: { GRAFT_NO_REFRESH: '1' }` added to settings.json, the same env repeated in .mcp.json (a cross-client file no Claude setting reaches), and a host-rule block added under the SKILL.md frontmatter so an agent reading the skill never runs a bare build. PROVEN, not assumed, by a two-arm experiment on graft/.graph/wiring.json mtime after touching a source file: arm A with GRAFT_NO_REFRESH=1 left mtime at 1788405760 unchanged (no rebuild); arm B with the switch unset moved it to 1788406301 and graft printed '[graft] refreshed the graph (1 file changed) before answering'. (2) Both shims baked `const BAKED = \"/home/patrik/zeroh-marketplace-trial-7-opus/node_modules/@nanonets/graft/dist/claude\"` — an absolute path to THIS worktree, in files destined for a shared repo. Set to \"\" in both: the shims' own best() skips a non-existent candidate, so resolution falls through to fromPkg(dir), which is the correct route for a repo-local devDependency and leaks no home path. (3) .mcp.json invoked bare `graft`, which does not exist here (`command -v graft` → rc 1; graft is a repo-local devDependency and notes decision 1 says 'invoked via npx'), so the MCP server could never have started — changed to command 'npx', args ['graft','mcp']. (4) permissions.allow listed Bash(graft:*), Bash(graft-dev:*) and Bash(node dist/cli.js:*), all naming binaries/paths that exist only in graft's OWN repo; pruned to the single Bash(npx graft:*) that is real here. Also reviewed and reported inert: the SECOND handleStop() call site at hooks.js's 'post-edit-sync' event branch, which .claude/settings.json never registers.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The GRAFT_NO_REFRESH switch is proven at the GRAFT seam (the two-arm mtime experiment above) but not at the HARNESS seam: settings.json `env` only reaches a session started after this commit, so that Claude Code really injects it into hook subprocesses is asserted from its documented behaviour, not measured here. Two independent layers cover the gap meanwhile — .mcp.json carries the env itself, and the SKILL.md host rule tells any agent to build only via capbuild — but the first session to open this repo should confirm it. Consequence for the trial, which task 7.3 must pre-register: the configuration under test is a NAMED DEVIATION from stock graft (no Stop hook, auto-refresh disabled, builds only via explicit `capbuild npx graft build .`), so graft's auto-refresh mechanism is OUT OF SCOPE for the before/after comparison and any future adoption proposal owes a separate decision on how to cap it on this host. Stock was not merely inconvenient, it was unmergeable: primaryCheckout is the fleet's shared checkout. Residency is measured for the CLI path only — a stdio MCP server, once Claude Code launches it, stays resident for that session's lifetime by design; that is outside the criterion's 'after the query' claim and is named here rather than hidden. Finally, the step's literal verify `bash -c \"! pgrep -f graft >/dev/null\"` is unrunnable as written (the probing shell's own argv matches the pattern — the 7.1 lesson); the assertion was made with the equivalent probe from a script file whose path contains no such substring.",
      },
      done: true,
      doneDate: '2026-09-03',
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
      transparencyReport: {
        whatWasDone:
          "roadmap/experiments/GRAFT-TRIAL.md (166 lines) pre-registers the trial in seven sections: what is under test and the named deviation from stock, the measured 7.1 footprint, arms + cut, cohorts, compared metrics, confounds, and the decision bar. It opens by declaring itself a pre-registration record rather than an architecture doc (so its dates and shas are the point, not rot) and states in its second paragraph that phase 7 renders NO adoption verdict. Cut recorded BOTH ways per notes decision 3: cut event = 2b8e87fcf906b4d3b11d3eca43a97c3a7af95c01 at 2026-09-03T03:38:21Z (the 7.2 wiring commit), cut phase = 25. Arms: baseline <= 25, treatment > 25 (in practice from phase 27). Compared metrics are ONLY PhaseEvalRecordShape fields (median spanMinutes, haltCount, unit-slot durationMs, gate.green rate); session token spend is called out in its own subsection as UNMEASURED with the explicit sentence that no cost claim in either direction can come out of this trial. The bar is quoted as a blockquote: >=20% median spanMinutes improvement in >=1 cohort at n >= SCORECARD_N_FLOOR (5) per arm with no green-rate regression; below floor = extend, never rank. The five files graft init wrote are tabulated per 7.2 step 1.",
        how:
          "Every number in the doc was computed from the live records, not restated from the plan, and that surfaced a design defect the plan could not have foreseen — ruled on by a software-architect call (claude-fable-5, child-cli, VERDICT: PROCEED_WITH_FIX, option A). THE CUT: the plan assumed phase 7 would execute in numeric order; it did not. Phases 8-25 were planned, executed and gated between the plan date (2026-08-23) and the wiring commit, so a phase-number cut of 7 would misclassify 17 pre-graft records as TREATMENT — and the ('4-6', false) treatment cell would then hold 11 records, above the floor, printing numbers exactly where the plan expects ABSTAIN. Decision 3 defines the cut by a FACT ('phases whose gate ran before the 7.2 wiring commit') and leaves the number to execution time; 25 is the number that implements that fact. The doc names the discrepancy and calls --cut 7 a misclassification in this repo rather than hiding it. TRANSITION PHASES: 7 (straddles the cut; its gate runs in a session started before the commit, so per 7.2's limitations the hooks and env never reached it) and 26 (this trial's parent, early tasks pre-wiring, record will land after the cut) are excluded from BOTH arms by the analysis plan, not by an instrument flag — adding --exclude would widen the contract 7.4's tests pin, so 7.4 instead prints member phase numbers per cell to make the exclusion checkable by eye. COHORTS: surfaceOf is /(^|\\/)(web|office|spa)\\// over keyFiles and is false for all 23 baseline records (no such directories exist here), so the pre-registered two-axis key collapses to bandFor alone. The two-axis key is KEPT as pre-registered with the degeneracy named — writing a replacement surface heuristic would be the second metrics dialect decision 6 forbids. The cell census is pre-registered too: only ('4-6', false) n=17 clears SCORECARD_N_FLOOR (5); ('7+') n=3 and ('1-3') n=3 are below floor before any treatment record exists, so the doc states plainly that a verdict needs >=5 treatment phases of 4-6 tasks. Two of my own factual claims were WRONG and the architect caught both, verified against the files before adoption: (a) I read haltCount at the record's top level and reported it absent everywhere — it lives under metrics and is present in 17/23 (phases 1-5, 8-11, 13-20), absent in 6 (6, 21-25); the doc now states the real split and reuses the scorecard's own convention (absent stays OUT of the denominator, never enters as 0; an arm with no evidence prints no-halt-evidence). (b) readPhaseEvalSamples returns pevalSample projections that DROP gate and date, so decision 4's gate.green rate and slot durationMs cannot come from the samples the instrument is told to use — the doc records that 7.4 reads the raw records alongside for those two fields, which is reading, not a second dialect. Also verified for the doc: gate.green is true in all 23 baseline records (so 'no regression' means treatment must also be 100% at n>=5), durationMs is carried only by the unit slot, and phase 6 has no startedAt so its spanMinutes is null and stays out of the median.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The doc's central weakness is stated in it rather than fixed, because it cannot be fixed by this design: the arms are SEQUENTIAL, so every change over the same period (the protocol itself, the executing models, plan quality, phase mix) is confounded with the treatment, and cohort matching controls phase size ONLY. No result from this trial can be read as causal, and the doc says so. Three further limits are pre-registered rather than resolved: the surface axis is degenerate here so half the pre-registered matching does nothing; the trialled configuration is not stock, so graft's auto-refresh mechanism is out of scope and an adoption proposal owes a separate capping decision; and the treatment arm needs >=5 phases of 4-6 tasks before the bar can be evaluated at all, which is a real cost this repo may never pay. Doc-rules tension, named deliberately: skills/do-phase/references/documentation-rules.md principle 3 forbids dates, version numbers and volatile line numbers in DOCS — a pre-registration is a report, where the timestamp and the sha ARE the artifact, so the doc declares its own class in its first line. It still cites no source line numbers, which do rot.",
      },
      done: true,
      doneDate: '2026-09-03',
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
      transparencyReport: {
        whatWasDone:
          "scripts/graft-trial-report.mjs slices the peval corpus into the trial's two arms: buildTrialReport(repoRoot, { cut }) returns { cells, warnings } keyed by arm x bandFor(taskCount) x surfaceOf(record); formatTrialReport(report) renders it; main(argv) is the CLI (--cut <phaseNumber>, optional --root). Every metric DEFINITION is imported from the plugin — readPhaseEvalSamples (eval-collect.mjs), bandFor/surfaceOf/spanMinutes (eval-score.mjs), SCORECARD_N_FLOOR (eval-scorecard.mjs), roadmapRoot (roadmap-root.mjs). A cell below the floor renders ABSTAIN(n=<k>) and carries no metric keys AT ALL (not nulled ones), so a number cannot be read off an under-floor cohort even by accident. scripts/graft-trial-report.test.mjs is 7 node:test cases over synthetic peval fixtures in per-test tmpdirs. LIVE SMOKE, both cuts, exit 0 each: `--cut 25` (the pre-registered cut) → `baseline 1-3 surface=false phases=[17,19,21] ABSTAIN(n=3)` / `baseline 4-6 surface=false phases=[1,2,3,4,5,6,8,11,14,15,16,18,20,22,23,24,25] n=17 medianSpanMinutes=303.9083333333333 haltRate=0.5 unitSlotMedianMs=1278386 greenRate=1` / `baseline 7+ surface=false phases=[9,10,13] ABSTAIN(n=3)` plus three notes reading `cohort <k>: baseline arm only, nothing to compare against` — all-baseline, treatment arm EMPTY, exactly the pre-registered expectation. `--cut 7` (the step's literal verify) also exits 0 and is kept as evidence of the ordering anomaly: it puts 11 pre-graft phases into `treatment 4-6 ... n=11 medianSpanMinutes=370.3833333333333` against `baseline 4-6 ... n=6 medianSpanMinutes=147.33333333333334`, i.e. it manufactures a 2.5x apparent regression out of phases graft never touched.",
        how:
          "TDD via the test-engineer role, resolved with `roadmap role resolve test-engineer --driver claude` → gpt-5.6-sol (child-cli) and launched as a headless codex child through the registry's own argv (launchArgv('codex', { worktree }) from cli/lib/drivers.mjs — no hand-built command). The brief was contract-only: problem, acceptanceCriteria, files, type signatures and the six behaviours to pin, with the implementation steps deliberately withheld. RED proven before any implementation existed: ERR_MODULE_NOT_FOUND on scripts/graft-trial-report.mjs, 1 test, 0 pass, 1 fail. GREEN after implementing: 7/7 pass, 0 fail. The suite went further than the brief in one useful way — it symlinks the consumer's lib/roadmap/schema.ts into each tmpdir, because readPhaseEvalSamples validates through the tsx schema bridge and would otherwise refuse a bare fixture root. Two contract decisions worth naming. (a) LOUD FAILURE is stricter here than in the scorecard, deliberately: readPhaseEvalSamples DEGRADES on a bad record (warns, drops it, returns the survivors), which is right for a scorecard where a missing sample only widens error bars, but a trial arm silently missing a phase moves the very median the decision bar is read off — so any non-empty warnings list from the reader ABORTS the run with every offending path in the message. (b) `median` is implemented locally (7 lines) because eval-score.mjs's median is module-private, not exported. That is generic arithmetic, not a metrics dialect: every metric DEFINITION (what a span is, what a band is, what the floor is, what counts as surface) still comes from the plugin, and the local median reproduces the scorecard's stated convention — an even count averages the two middles rather than picking a side. The scorecard's halt convention is reused rather than reinvented: a record without metrics.haltCount stays OUT of the denominator instead of entering as 0, and an arm with no evidence at all yields the 'no-halt-evidence' sentinel. Per notes decision 7 this root-level suite is NOT covered by the gate's unit slot (which runs only the plugin suite); the step verifies carry it, run as `capbuild node --test` per the host rules.",
        compromises: 'None',
        skipped: 'None',
        hardcoded: 'None',
        limitations:
          "The instrument has no --exclude flag, so the protocol's exclusion of the two transition phases (7 and 26) is enforced by the reader's eye, not by the tool: every cell prints its member phase numbers precisely so that exclusion is checkable, and GRAFT-TRIAL.md names both phases. Adding the flag would widen the contract this task's tests pin and was ruled out for a spike. `unitSlotMedianMs` compares the `unit` slot alone because it is the only slot these records carry a durationMs for; a consumer whose lint/types/build slots are bound would need that generalized. The `warnings` channel reports only cohorts present in a single arm — real and useful today (all three cohorts are baseline-only), but it is not a completeness check on the corpus. And the instrument can only ever be as honest as the cut it is given: `--cut 7` exits 0 and prints confident, badly wrong numbers, which is exactly why the cut is pre-registered in the doc rather than left to the caller.",
      },
      done: true,
      doneDate: '2026-09-03',
    },
  ],
})
