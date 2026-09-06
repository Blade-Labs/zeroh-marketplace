import { definePhase } from '../../lib/roadmap/schema'

/**
 * NATIVEGREEN establishes valid packaging, repository-governance precedence, and authority-safe
 * launch defaults before shared lifecycle or adapter work depends on them.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 36,
  name: 'Dual-host packaging, governance precedence, and safe authority defaults',
  plannedBy: { model: 'gpt-5.6-sol' },
  status: 'backlog',
  category: 'feature',
  kind: 'hardening',
  source: 'NATIVEGREEN governance plane; architecture designRef §Semantic core and harness adapters.',
  priority: 'HIGH',
  arcId: 'NATIVEGREEN',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/.codex-plugin/plugin.json',
    'plugins/zeroh-roadmap/.claude-plugin/plugin.json',
    'plugins/zeroh-roadmap/skills/full-code-review/SKILL.md',
    'plugins/zeroh-roadmap/agents/references/executor-reference.md',
    'plugins/zeroh-roadmap/cli/lib/drivers.mjs',
    'plugins/zeroh-roadmap/cli/lib/drivers.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/governance.mjs',
    'plugins/zeroh-roadmap/cli/lib/governance.test.mjs',
    'plugins/zeroh-roadmap/scripts/validate-packaging.mjs',
    'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/governance.md',
    'lib/roadmap/schema.ts',
  ],
  stakeholderDemo: 'Claude Code and Codex both accept the package, and every mutating launch carries repository instructions and a non-escalating authority envelope.',
  userFacing: false,
  reviewScope: 'full',
  assumptions: [
    { claim: 'Codex and Claude use separate committed plugin manifests.', verify: 'test -f plugins/zeroh-roadmap/.codex-plugin/plugin.json && test -f plugins/zeroh-roadmap/.claude-plugin/plugin.json', onFalse: 'ESCALATE' },
    { claim: 'Driver launch policy is centralized in cli/lib/drivers.mjs.', verify: 'grep -qF "export const DRIVERS" plugins/zeroh-roadmap/cli/lib/drivers.mjs', onFalse: 'ESCALATE' },
    { claim: 'The supporting executor reference currently sits below agents and can be relocated without changing an agent id.', verify: 'test -f plugins/zeroh-roadmap/agents/references/executor-reference.md && ! grep -q "^name:" plugins/zeroh-roadmap/agents/references/executor-reference.md', onFalse: 'ESCALATE' },
  ],
  tasks: [
    {
      id: '36.1', title: 'Make the Codex package validate and surface its skills',
      problem: 'The Codex manifest has unsupported/missing fields and one skill has invalid frontmatter, so runtime parity cannot be tested.',
      steps: [
        { file: 'plugins/zeroh-roadmap/.codex-plugin/plugin.json', description: 'Replace the unsupported hooks entry with valid interface metadata while retaining skill discovery → verify: python3 /home/patrik/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/zeroh-roadmap' },
        { file: 'plugins/zeroh-roadmap/skills/full-code-review/SKILL.md', description: 'Quote or fold the description without changing its trigger semantics → verify: python3 /home/patrik/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/zeroh-roadmap' },
      ],
      acceptanceCriteria: ['The official Codex validator exits 0.', 'A cache-busted test install exposes every declared roadmap skill.'],
      files: ['plugins/zeroh-roadmap/.codex-plugin/plugin.json', 'plugins/zeroh-roadmap/skills/full-code-review/SKILL.md'],
      testMode: 'none', done: false,
    },
    {
      id: '36.2', title: 'Clear Claude package discovery warnings',
      problem: 'Claude validation currently reports misplaced metadata and scans a reference document as an agent.',
      steps: [
        { file: 'plugins/zeroh-roadmap/.claude-plugin/plugin.json', description: 'Remove manifest-only metadata that belongs to the marketplace entry → verify: claude plugin validate plugins/zeroh-roadmap' },
        { file: 'plugins/zeroh-roadmap/skills/do-phase/references/executor-reference.md', description: 'Relocate the support document out of agents, update every loading and measurement pointer, and record the move in DIET-LEDGER → verify: bash -c "test -f plugins/zeroh-roadmap/skills/do-phase/references/executor-reference.md && ! test -e plugins/zeroh-roadmap/agents/references/executor-reference.md && ! rg -n \"agents/references/executor-reference.md\" plugins/zeroh-roadmap/agents plugins/zeroh-roadmap/cli/measure-manifest.json"' },
      ],
      acceptanceCriteria: ['Claude validation exits 0 with zero plugin-owned warnings.', 'The phase executor still loads the relocated reference explicitly.'],
      files: ['plugins/zeroh-roadmap/.claude-plugin/plugin.json', 'plugins/zeroh-roadmap/agents/references/executor-reference.md', 'plugins/zeroh-roadmap/skills/do-phase/references/executor-reference.md', 'plugins/zeroh-roadmap/agents/phase-executor.md', 'plugins/zeroh-roadmap/cli/measure-manifest.json', 'plugins/zeroh-roadmap/DIET-LEDGER.md'],
      testMode: 'none', done: false,
    },
    {
      id: '36.3', title: 'Resolve applicable repository governance before mutation',
      problem: 'Child envelopes privilege Claude conventions and do not model AGENTS instructions, access boundaries, or repository-native task runners.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/governance.mjs', description: 'Add resolveGovernance(root,targetPaths) returning ordered applicable instruction files and required pre-edit checks without interpreting them away → verify: node --test plugins/zeroh-roadmap/cli/lib/governance.test.mjs' },
        { file: 'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/governance.md', description: 'Define the one precedence contract cited by every mutating skill and child envelope: applicable AGENTS/CLAUDE files, access checks, native task runners, and typed refusal → verify: node --test plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs', description: 'Embed the resolved governance receipt in run, plan, and review envelopes and return a typed hold when a required boundary check refuses → verify: node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs' },
      ],
      acceptanceCriteria: ['Nested AGENTS.md and CLAUDE.md fixtures resolve nearest-applicable rules in deterministic order.', 'A refused boundary check causes no edit or launch.', 'Nx-governed fixtures retain their pnpm nx command requirement verbatim.'],
      files: ['plugins/zeroh-roadmap/cli/lib/governance.mjs', 'plugins/zeroh-roadmap/cli/lib/governance.test.mjs', 'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/references/governance.md', 'plugins/zeroh-roadmap/skills/using-zeroh-roadmap/SKILL.md', 'plugins/zeroh-roadmap/skills/plan-phase/SKILL.md', 'plugins/zeroh-roadmap/skills/do-phase/SKILL.md', 'plugins/zeroh-roadmap/skills/do-arc/SKILL.md', 'plugins/zeroh-roadmap/cli/lib/protocol-refs.test.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs'],
      testMode: 'tdd', done: false,
    },
    {
      id: '36.4', title: 'Normalize authority without allowing child escalation',
      problem: 'The Codex driver defaults to bypass posture and no shared contract proves a child stayed within parent authority.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/drivers.mjs', description: 'Replace bypass default with inherit/workspace-write/isolated-unsafe profiles and intersect requested authority with the parent receipt → verify: node --test plugins/zeroh-roadmap/cli/lib/drivers.test.mjs' },
        { file: 'plugins/zeroh-roadmap/templates/schema.ts', description: 'Add the normalized AuthorityEnvelopeShape plus raw-native-policy evidence used by later run receipts and project it byte-identically to the legacy consumer schema → verify: npm --prefix plugins/zeroh-roadmap test' },
      ],
      acceptanceCriteria: ['Default child posture is inherit.', 'Every attempted filesystem/network/git/external-write enlargement is refused.', 'Unsafe isolation is available only through explicit recorded authorization.'],
      files: ['plugins/zeroh-roadmap/cli/lib/drivers.mjs', 'plugins/zeroh-roadmap/cli/lib/drivers.test.mjs', 'plugins/zeroh-roadmap/templates/schema.ts', 'lib/roadmap/schema.ts', 'plugins/zeroh-roadmap/scripts/schema.test.ts'],
      testMode: 'tdd', done: false,
    },
    {
      id: '36.5', title: 'Ratchet both package contracts in one validation entrypoint',
      problem: 'Separate manual validator runs allow one host package to regress unnoticed.',
      steps: [
        { file: 'plugins/zeroh-roadmap/scripts/validate-packaging.mjs', description: 'Run both official validators, manifest drift checks, and skill/card inventory assertions with typed per-host results → verify: node plugins/zeroh-roadmap/scripts/validate-packaging.mjs' },
        { file: 'plugins/zeroh-roadmap/package.json', description: 'Bind validate-packaging into the plugin test contract without duplicating validator argv → verify: npm --prefix plugins/zeroh-roadmap test' },
      ],
      acceptanceCriteria: ['One command fails when either manifest or discovery inventory is mutated.', 'A second clean validation run is byte-stable apart from timestamps.'],
      files: ['plugins/zeroh-roadmap/scripts/validate-packaging.mjs', 'plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs', 'plugins/zeroh-roadmap/package.json'],
      testMode: 'tdd', done: false,
    },
    {
      id: '36.6', title: 'Prove clean and repeated native installation',
      problem: 'Validator success alone does not prove either host installs one mapping and exposes the complete skill inventory on a second run.',
      steps: [
        { file: 'plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs', description: 'Drive isolated first and second Claude/Codex installs with recorded CLI versions and assert one plugin mapping plus the exact declared skill inventory → verify: node --test plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs' },
        { file: 'plugins/zeroh-roadmap/scripts/validate-packaging.mjs', description: 'Emit normalized install and discovery receipts whose semantic fields remain identical across the second install → verify: node plugins/zeroh-roadmap/scripts/validate-packaging.mjs --check-repeat' },
      ],
      acceptanceCriteria: ['Both hosts install successfully in clean isolated homes at recorded versions.', 'Second install leaves one mapping and the same complete skill inventory.', 'Receipts distinguish an unavailable host from a valid empty inventory.'],
      files: ['plugins/zeroh-roadmap/scripts/validate-packaging.mjs', 'plugins/zeroh-roadmap/scripts/validate-packaging.test.mjs', 'plugins/zeroh-roadmap/.codex-plugin/plugin.json', 'plugins/zeroh-roadmap/.claude-plugin/plugin.json'],
      testMode: 'tdd', done: false,
    },
  ],
  reviewRecord: { date: '2026-09-04', model: 'gpt-5.6-sol', verdict: 'READY', via: 'executed' },
  notes: 'interview: inherited from NATIVEGREEN. userFacing false ratified: packaging and governance enforcement have no product flag surface, so no flag applies. reviewScope full ratified: authority, discovery, and instruction precedence are governed seams. testMode ratified: manifest/Markdown moves use none and executable reducers, launch policy, and validation/install guards use TDD; no external dependency or shipped asset is introduced. Documentation is intentionally deferred to phase 45. [FIXED review] Restored promise-ledger coverage with 36.6; bound governance to every mutating protocol rather than only Codex; named the executor-reference destination and all pointer/DIET-LEDGER consumers; projected AuthorityEnvelopeShape to the legacy consumer schema; removed the unsupported --runInBand argument.',
})
