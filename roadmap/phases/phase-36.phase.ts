import { definePhase } from '../../lib/roadmap/schema'

/** timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min */
export default definePhase({
  phase: 36,
  name: 'Governance precedence, safe authority, and dual-host packaging proof',
  plannedBy: { model: 'unverified' },
  status: 'backlog', category: 'feature', kind: 'hardening',
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
      testMode: 'tdd', done: false, interfaces: { produces: ['GovernanceReceipt', 'resolveGovernance'] },
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
      testMode: 'tdd', done: false, interfaces: { consumes: ['GovernanceReceipt'], produces: ['AuthorityEnvelopeShape', 'intersectAuthority'] },
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
      files: ['plugins/zeroh-roadmap/scripts/validate-packaging.mjs','plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs','plugins/zeroh-roadmap/package.json','plugins/zeroh-roadmap/.codex-plugin/plugin.json','plugins/zeroh-roadmap/.claude-plugin/plugin.json','plugins/zeroh-roadmap/agents/references/executor-reference.md','plugins/zeroh-roadmap/cli/measure-manifest.json'],
      testMode: 'tdd', done: false,
    },
    {
      id: '36.4', title: 'Prove bounded repeated native installation and discovery',
      problem: 'Static validation does not prove an available host installs one mapping and exposes the declared inventory on a clean second run; prior release evidence stopped short of final-source dual-host confirmation.',
      steps: [
        { file: 'plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs', description: 'Drive isolated first and second installs for each available Claude and Codex CLI at its recorded version, asserting one mapping, exact declared discovery inventory, and unchanged effective authority; keep host execution serial and bounded → verify: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs' },
        { file: 'plugins/zeroh-roadmap/scripts/validate-packaging.mjs', description: 'Emit normalized install/discovery receipts binding host version, package bytes, inventory, governance digest, and authority envelope; classify unavailable or refused hosts as unresolved → verify: node plugins/zeroh-roadmap/scripts/validate-packaging.mjs --check-repeat' },
      ],
      acceptanceCriteria: [
        'Every available host installs twice in a clean isolated home with one mapping and identical semantic inventory: node plugins/zeroh-roadmap/scripts/validate-packaging.mjs --check-repeat.',
        'A missing, refused, or unprobeable host yields unresolved evidence and a non-zero overall result rather than packaging-valid: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs.',
        'The second-run receipt is idempotent apart from declared timestamps and retains governance and authority digests: capbuild node plugins/zeroh-roadmap/scripts/run-scoped-tests.mjs plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs.',
      ],
      files: ['plugins/zeroh-roadmap/scripts/validate-packaging.mjs','plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs','plugins/zeroh-roadmap/.codex-plugin/plugin.json','plugins/zeroh-roadmap/.claude-plugin/plugin.json'],
      testMode: 'tdd', done: false, interfaces: { consumes: ['GovernanceReceipt', 'AuthorityEnvelopeShape'], produces: ['PackagingValidationReceipt'] },
    },
  ],
  reviewRecord: { date: '2026-09-06', model: 'unverified', verdict: 'READY', via: 'executed' },
  notes: 'Resume preflight repair: absence of future modules and presence of defects are historical observations at036b7c5, not runtime prerequisites. The original observation remains in Git; legitimate in-progress work must not be stopped because earlier tasks repaired it. Preflights are cheap; behavior suites belong to task/gate verification. interview: inherited from NATIVEGREEN. Replan preserves the prior owner-approved packaging-valid and no-authority-enlargement outcomes while consolidating delivered manifest, executor-reference, role-registry, and driver-registry work instead of reimplementing it. The obsolete phase-34 dependency is replaced by explicit shipped-source prerequisites 30be1fe and 036b7c5; phase 34 remains in-progress and is not declared complete. Its retained full-suite/current-source Greenfield refresh limitation is not a prerequisite for this distinct zeroh-roadmap packaging proof, which keeps its own bounded current-source dual-host confirmation. requested collaboration model: gpt-5.6-sol; planner runtime self-reported GPT-6 but its exact model id was unattested, so plannedBy.model is unverified. userFacing false: packaging and control-plane enforcement have no product flag surface. reviewScope full: authority, repository instructions, and native package discovery are governed seams. testMode ratified: reducers, launch policy, and executable packaging guards use TDD. Native confirmation runs only after cheap validation and remains bounded and serial; UNAVAILABLE is unresolved, never success. Documentation remains phase 45. ## Hypotheses\n1. CONFIRMED — governance and authority remain incomplete because governance.mjs is absent and cli/commands/codex.mjs at 036b7c5 still documents a bypass posture.\n2. REFUTED — package structure itself is wholly absent: both manifests, the relocated executor reference, and central role/driver registries are present at 036b7c5.',
})
