import { definePhase } from '../../lib/roadmap/schema'

/** timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min */
export default definePhase({
  phase: 36,
  name: 'Governance precedence, safe authority, and dual-host packaging proof',
  plannedBy: { model: 'unverified' },
  status: 'in-progress', category: 'feature', kind: 'hardening',
  source: 'NATIVEGREEN governance plane; ratified architecture §Semantic core and harness adapters; replanned against 036b7c5.',
  priority: 'HIGH', arcId: 'NATIVEGREEN', dependsOn: [], conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/governance.mjs',
    'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/governance.md',
    'plugins/zeroh-roadmap/cli/lib/drivers.mjs',
    'plugins/zeroh-roadmap/cli/commands/codex.mjs',
    'plugins/zeroh-roadmap/templates/schema.ts',
    'lib/roadmap/schema.ts',
    'plugins/zeroh-roadmap/scripts/validate-packaging.mjs',
    'plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs',
  ],
  stakeholderDemo: 'Both packages validate cheaply first, then available Claude and Codex hosts prove repeat installation and discovery under repository instructions and a non-escalating authority envelope.',
  userFacing: false, reviewScope: 'full',
  assumptions: [
    {
      "claim": "Both native package manifests are present.",
      "verify": "test -f plugins/zeroh-roadmap/.codex-plugin/plugin.json && test -f plugins/zeroh-roadmap/.claude-plugin/plugin.json",
      "onFalse": "ESCALATE"
    },
    {
      "claim": "One shipped role/launch registry is available for extension.",
      "verify": "grep -qF 'export const DRIVERS' plugins/zeroh-roadmap/cli/lib/drivers.mjs && grep -qF 'export function resolveRole' plugins/zeroh-roadmap/cli/lib/roles.mjs",
      "onFalse": "ESCALATE"
    }
  ],
  tasks: [
    {
      id: '36.1', title: 'Resolve applicable repository governance before mutation',
      problem: 'Child envelopes do not share a typed resolver for applicable AGENTS.md and CLAUDE.md instructions, access boundaries, and repository-native task runners.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/governance.mjs', description: 'Add resolveGovernance(root, targetPaths) returning ordered applicable instruction files, access checks, and native runner commands without interpreting their content away → verify: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/cli/lib/governance.test.mjs' },
        { file: 'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/governance.md', description: 'Define the canonical precedence, boundary-check, native-runner, and typed-refusal contract consumed by every mutating child envelope → verify: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs', description: 'Attach the resolved governance receipt to run, plan, and review requests and refuse before launch when a required boundary check fails → verify: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/cli/commands/codex.test.mjs' },
      ],
      acceptanceCriteria: [
        'Nested instruction fixtures resolve nearest-applicable rules in deterministic order: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/cli/lib/governance.test.mjs.',
        'A refused access or native-runner precheck records a typed hold and launches no child: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/cli/commands/codex.test.mjs.',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/governance.mjs','plugins/zeroh-roadmap/cli/lib/governance.test.mjs','plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/governance.md','plugins/zeroh-roadmap/skills/using-zeroh-roadmap/SKILL.md','plugins/zeroh-roadmap/skills/plan-phase/SKILL.md','plugins/zeroh-roadmap/skills/do-phase/SKILL.md','plugins/zeroh-roadmap/skills/do-arc/SKILL.md','plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs','plugins/zeroh-roadmap/cli/commands/codex.mjs','plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd', done: true, doneDate: '2026-09-06', interfaces: { produces: ['GovernanceReceipt', 'resolveGovernance'] },
      transparencyReport: {
        whatWasDone: 'Resolve repository governance before child launch, installation, or carried input; persist the actual child checkout instructions and runner bindings.',
        how: 'Independent test-first resolver and launcher failures were repaired. The real capbuild-backed task gate passed 136 checks with no skips; types is configured declared-none. Review repaired canonical symlink handling, dangling-rule refusal, child-checkout scope, live-lane refusal order, and resume installation behavior. Governance reference invariant: broken pointer RED; renamed owner RED with missing-file error; unrelated prose decoy GREEN in disposable copies. Raw mutation results: .building/nativegreen-36-1-reference-mutations.json. Gate: roadmap/.gate/36/run-000004-2026-09-06T21-03-01-689Z.json.',
        compromises: 'None', skipped: 'None', hardcoded: 'None',
        limitations: 'Launcher tests use fake child binaries. Native authority and installation confirmation belong to tasks 36.2 and 36.4; this task gate is partial evidence. Test and implementation agent runtime model identities are unverified; gpt-5.6-sol was requested.',
      },
    },
    {
      id: '36.2', title: 'Normalize authority without child escalation',
      problem: 'The shipped driver registry centralizes launch argv, but the Codex lane still carries a bypass posture and no shared receipt proves requested authority stayed within its parent ceiling.',
      steps: [
        { file: 'plugins/zeroh-roadmap/templates/schema.ts', description: 'Define AuthorityEnvelopeShape with parent ceiling, requested/effective profiles, filesystem/network/git/external-write bounds, authorization provenance, and raw native policy evidence; project it byte-identically to the active legacy schema → verify: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/scripts/schema.test.ts' },
        { file: 'plugins/zeroh-roadmap/cli/lib/drivers.mjs', description: 'Extend the existing registry with inherit, workspace-write, and explicitly authorized isolated-unsafe profiles and an intersectAuthority(parent, requested) fail-closed reducer → verify: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/cli/lib/drivers.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs', description: 'Build Codex argv only from the effective authority envelope and persist raw native policy evidence before launch → verify: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/cli/commands/codex.test.mjs' },
      ],
      acceptanceCriteria: [
        'Default child posture inherits its parent ceiling and every attempted enlargement is rejected: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/cli/lib/drivers.test.mjs.',
        'Unsafe isolation appears only with explicit authorization provenance, and request/argv/receipt remain consistent: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/cli/commands/codex.test.mjs.',
        'Template and active legacy schemas expose the same AuthorityEnvelopeShape: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/scripts/schema.test.ts.',
      ],
      files: ['plugins/zeroh-roadmap/templates/schema.ts','lib/roadmap/schema.ts','plugins/zeroh-roadmap/scripts/schema.test.ts','plugins/zeroh-roadmap/cli/lib/drivers.mjs','plugins/zeroh-roadmap/cli/lib/drivers.test.mjs','plugins/zeroh-roadmap/cli/commands/codex.mjs','plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd', done: true, doneDate: '2026-09-06', interfaces: { consumes: ['GovernanceReceipt'], produces: ['AuthorityEnvelopeShape', 'intersectAuthority'] },
      transparencyReport: {
        whatWasDone: 'Replace unconditional Codex bypass with explicit parent authority, exact inheritance or narrowing, native automatic approval review, and reusable bounded resume commands across run, plan and review.',
        how: 'Independent test-first reducer, schema and launcher checks passed through the real capbuild task gate after repairing cross-field schema failures. Review additionally repaired malformed authorization provenance, unsafe inheritance acknowledgment, pre-mutation native mapping, and resume expansion from noncanonical saved bounds. Actual fake-child process argv matches the durable native receipt. Both schema homes are byte-identical. Final gate: roadmap/.gate/36/run-000008-2026-09-06T21-55-31-952Z.json, exit 0 in 53.6 seconds; types declared-none. Owner approval and native control rationale: roadmap/arc-evals/NATIVEGREEN-36.2-approval.md.',
        compromises: 'None', skipped: 'None', hardcoded: 'None',
        limitations: 'Native runtime isolation is unverified; launcher evidence uses fake binaries. Automatic review can deny exceptions, and gitPush/externalWrites are workflow constraints without dedicated native enforcement. Explicit operator provenance records delegation, not OS attestation. Architect fallback and worker runtime identities are unverified; no external Claude architecture review is claimed. Task evidence does not certify phase completion.',
      },
    },
    {
      id: '36.3', title: 'Consolidate cheap dual-host packaging validation',
      problem: 'The manifests, relocated executor reference, and shared registries are shipped, but no one entrypoint prevents either host package or declared discovery inventory from drifting.',
      steps: [
        { file: 'plugins/zeroh-roadmap/scripts/validate-packaging.mjs', description: 'Run the official Codex validator first, the Claude validator second, then manifest, skill/card inventory, protocol-reference, and relocated-reference drift checks with typed per-host results → verify: node plugins/zeroh-roadmap/scripts/validate-packaging.mjs --validation-only' },
        { file: 'plugins/zeroh-roadmap/package.json', description: 'Bind validation-only packaging checks into the existing plugin contract without duplicating validator argv or rerunning product suites → verify: node plugins/zeroh-roadmap/scripts/validate-packaging.mjs --validation-only' },
      ],
      acceptanceCriteria: [
        'One validation-only command fails for a mutated manifest, malformed skill frontmatter, missing declared skill, or stale executor-reference pointer: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs.',
        'An unavailable official validator is reported UNAVAILABLE and cannot be counted as success: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs.',
      ],
      files: ['plugins/zeroh-roadmap/scripts/validate-packaging.mjs','plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs','plugins/zeroh-roadmap/package.json','plugins/zeroh-roadmap/.codex-plugin/plugin.json','plugins/zeroh-roadmap/.claude-plugin/plugin.json','plugins/zeroh-roadmap/agents/references/executor-reference.md','plugins/zeroh-roadmap/cli/measure-manifest.json','plugins/zeroh-roadmap/scripts/emit-manifests.mjs','plugins/zeroh-roadmap/scripts/emit-manifests.test.mjs','plugins/zeroh-roadmap/hooks/hooks.json','plugins/zeroh-roadmap/hooks/claude-hooks.json','plugins/zeroh-roadmap/skills/full-code-review/SKILL.md','plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/codex-tools.md','plugins/zeroh-roadmap/DIET-LEDGER.md'],
      testMode: 'tdd', done: true, doneDate: '2026-09-06',
      transparencyReport: {
        whatWasDone: 'Add one bounded validation-only packaging command and repair the source mismatches it exposed: supported Codex interface, explicit isolated Claude hook configuration, and valid skill frontmatter.',
        how: 'Independent TDD and parent review passed the real capbuild task gate: 30 tests, zero failures/skips, 5.8 seconds; roadmap/.gate/36/run-000010-2026-09-06T22-08-08-243Z.json. Real official Codex and Claude validators plus all internal checks returned PASS; raw report .building/nativegreen-36-3-official-validation.json. Packaging guard fixture proof: malformed manifest/frontmatter, missing skill/reference and conventional hook configuration RED; renamed executor owner RED naming the anchor; legal adjacent reference and YAML-looking body decoys GREEN. Validation-only CLI missing-tool test was nonzero UNAVAILABLE with unchanged fixture bytes/mtimes. Architect PROCEED_WITH_FIX allowed the minimal emitter/hook compatibility seam; actual disposable Claude validation accepted the explicit relocated hook path.',
        compromises: 'None', skipped: 'None', hardcoded: 'None',
        limitations: 'Official Claude validation retains three nonblocking warnings about category metadata, root CLAUDE.md context and executor-reference frontmatter. Packaging PASS is not native installation or activation evidence; task 36.4 owns those observations. Worker and architect model runtime identities remain unverified. PyYAML and the official validator must be installed; unavailable tools produce unresolved nonzero results.',
      },
    },
    {
      id: '36.4', title: 'Prove bounded repeated native installation and discovery',
      problem: 'Static validation does not prove an available host installs one mapping and exposes the declared inventory on a clean second run; prior release evidence stopped short of final-source dual-host confirmation.',
      steps: [
        { file: 'plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs', description: 'Drive isolated first and second installs for each available Claude and Codex CLI at its recorded version, asserting one mapping, exact declared discovery inventory, and unchanged effective authority; keep host execution serial and bounded → verify: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs' },
        { file: 'plugins/zeroh-roadmap/scripts/validate-packaging.mjs', description: 'Emit normalized install/discovery receipts binding host version, package bytes, inventory, governance digest, and authority envelope; classify unavailable or refused hosts as unresolved → verify: node plugins/zeroh-roadmap/scripts/validate-packaging.mjs --check-repeat --parent-authority workspace-write' },
      ],
      acceptanceCriteria: [
        'Every available host installs twice in a clean isolated home with one mapping and identical semantic inventory: node plugins/zeroh-roadmap/scripts/validate-packaging.mjs --check-repeat --parent-authority workspace-write.',
        'A missing, refused, or unprobeable host yields unresolved evidence and a non-zero overall result rather than packaging-valid: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs.',
        'The second-run receipt is idempotent apart from declared timestamps and retains governance and authority digests: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs.',
      ],
      files: ['plugins/zeroh-roadmap/scripts/validate-packaging.mjs','plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs','plugins/zeroh-roadmap/.codex-plugin/plugin.json','plugins/zeroh-roadmap/.claude-plugin/plugin.json'],
      testMode: 'tdd', done: true, doneDate: '2026-09-06', interfaces: { consumes: ['GovernanceReceipt', 'AuthorityEnvelopeShape'], produces: ['PackagingValidationReceipt'] },
      transparencyReport: {
        whatWasDone: 'Prove two bounded local installations and native discovery runs per host under isolated configuration homes, comparing one mapping, actual installed bytes, exact host-specific inventory, versions and declared governance/authority.',
        how: 'Independent tests and parent review passed the real task gate: 18 checks, no failures/skips, 5.5 seconds; roadmap/.gate/36/run-000012-2026-09-06T22-24-52-914Z.json. The real validation-only preflight passed, then --check-repeat --parent-authority workspace-write passed both hosts serially: Codex CLI 0.153.4 surfaced all 14 skills twice; Claude 2.1.257 reported 14 skills, 9 agents and 7 hook events twice. Each attempt retained exactly one mapping and installed package bytes matching source. Durable raw command/normalized receipt: roadmap/arc-evals/NATIVEGREEN-packaging-2026-09-06.json. Review corrected fixture/native-shape mismatch, isolated process env/cwd, alias-to-installed-path parsing, inventory consistency versus completeness, and installed-byte tampering detection.',
        compromises: 'None', skipped: 'None', hardcoded: 'None',
        limitations: 'This is local native packaging and discovery evidence for the recorded CLI versions, not model execution, hook activation, cross-host performance, or OS authority enforcement. Management commands inherit supervisor policy; declared authority equality and isolated configuration homes do not attest native sandbox enforcement. Full phase gate and independent correctness review remain separate. Worker runtime model identities are unverified.',
      },
    },
  ],
  gate: {
    "lint": "clean",
    "typeCheck": "clean",
    "unitTests": {
      "passed": 2172,
      "total": 2172,
      "notes": "Full gate at826d79c: 92 shards, no skips. Subsequent resume repair d8c62fe passed136/136 affected launcher tests and fresh independent review."
    },
    "integrationTests": {
      "passed": 0,
      "total": 0,
      "notes": "Declared absent by repository config."
    },
    "e2eTests": {
      "passed": 0,
      "total": 0,
      "notes": "Not bound in this phase; local native packaging is recorded separately."
    },
    "build": "clean"
  },
  gateRounds: [
    {
      "round": 0,
      "agent": "quality-pass",
      "model": "unverified (requested gpt-5.6-sol)",
      "verdict": "clean",
      "summary": "Independent one-shot quality pass: no changes, hard stops, skipped cleanup or noted bugs. Source remained826d79c.",
      "findings": []
    },
    {
      "round": 1,
      "agent": "code-reviewer",
      "model": "unverified (requested gpt-5.6-sol)",
      "verdict": "findings-fixed",
      "summary": "Independent review found one HIGH resume-context defect; repair is being prepared in an isolated checkout and requires fresh independent review.",
      "findings": [
        {
          "file": "plugins/zeroh-roadmap/cli/commands/codex.mjs",
          "line": 1027,
          "severity": "HIGH",
          "confidence": 97,
          "description": "Dead/blocked resume commands drop custom worktree, base, label and model override; following the hint can abandon partial work or select another journal.",
          "fixedInCommit": "d8c62fe"
        }
      ]
    },
    {
      "round": 2,
      "agent": "code-reviewer",
      "model": "unverified (requested gpt-5.6-sol)",
      "verdict": "clean",
      "summary": "Fresh independent follow-up verified d8c62fe: resume preserves worktree/base/label/model policy with POSIX quoting, retains authority, and refuses malformed context. The affected launcher suite passed136/136; unchanged full-gate shards remain green.",
      "findings": []
    }
  ],
  metrics: {
      commits: 6,
      linesAdded: 3074,
      linesRemoved: 130,
      filesChanged: 31,
      testsAtStart: 0,
      testsAtEnd: 2172,
      testsAdded: 0
  },
  compromises: 'None',
  executionResult: {
    "phase": 36,
    "status": "checkpoint",
    "driver": {
      "model": "gpt-6 (self-reported; exact runtime unverified)",
      "lane": "codex"
    },
    "modelPolicy": {
      "source": "config",
      "preset": "codex"
    },
    "checkpoint": {
      "committedSha": "d8c62fe",
      "reason": "All checks and independent review passed; history curation and completion record remain.",
      "resume": "Curate only phase36 owned commits, mark complete and run verify-complete, then continue NATIVEGREEN."
    },
    "compromises": [],
    "skipped": [],
    "hardcoded": [],
    "surfaced": [],
    "hardStops": [],
    "gateRounds": 3
  },
  reviewRecord: { date: '2026-09-06', model: 'unverified (requested gpt-5.6-sol)', verdict: 'READY', via: 'executed' },
  notes: 'Completion evidence: full gate passed 2172 aggregate Node TAP cases across 92 distinct shard files at826d79c; affected resume tests passed136/136 after d8c62fe, followed by independent clean R2 and refreshed native packaging PASS. Metrics test baseline unobserved: PhaseMetricsShape requires numeric testsAtStart/testsAdded, so both carry the legacy 0 sentinel; neither means zero baseline tests or zero tests added. testsAtEnd=2172 is the observed full-gate case count, not a fabricated aggregate after the later targeted repair. Reproduction: roadmap/arc-evals/NATIVEGREEN-phase-36-test-counts.json. Architect PROCEED_WITH_FIX approved this existing compatibility interpretation; a future metrics schema should distinguish unknown structurally. Canonical collector derived Git metrics but returned absent time fields, which remain omitted. Resume preflight repair: absence of future modules and presence of defects are historical observations at036b7c5, not runtime prerequisites. The original observation remains in Git; legitimate in-progress work must not be stopped because earlier tasks repaired it. Preflights are cheap; behavior suites belong to task/gate verification. interview: inherited from NATIVEGREEN. Replan preserves the prior owner-approved packaging-valid and no-authority-enlargement outcomes while consolidating delivered manifest, executor-reference, role-registry, and driver-registry work instead of reimplementing it. The obsolete phase-34 dependency is replaced by explicit shipped-source prerequisites 30be1fe and 036b7c5; phase 34 remains in-progress and is not declared complete. Its retained full-suite/current-source Greenfield refresh limitation is not a prerequisite for this distinct zeroh-roadmap packaging proof, which keeps its own bounded current-source dual-host confirmation. requested collaboration model: gpt-5.6-sol; planner runtime self-reported GPT-6 but its exact model id was unattested, so plannedBy.model is unverified. userFacing false: packaging and control-plane enforcement have no product flag surface. reviewScope full: authority, repository instructions, and native package discovery are governed seams. testMode ratified: reducers, launch policy, and executable packaging guards use TDD. Native confirmation runs only after cheap validation and remains bounded and serial; UNAVAILABLE is unresolved, never success. Documentation remains phase 45. ## Hypotheses\n1. CONFIRMED — governance and authority remain incomplete because governance.mjs is absent and cli/commands/codex.mjs at 036b7c5 still documents a bypass posture.\n2. REFUTED — package structure itself is wholly absent: both manifests, the relocated executor reference, and central role/driver registries are present at 036b7c5.',
})
