#!/usr/bin/env node

/**
 * Roadmap migration audit.
 *
 * Compares a target project's roadmap implementation against the canonical
 * zeroh-roadmap templates that ship with this plugin. Reports:
 *  - Which schema features the target is missing.
 *  - Which steady-state artifacts (schema, scripts, backlog, etc.) are missing.
 *  - Which `status: 'done'` phase files would break under the current strict
 *    DonePhaseShape (required gate, gateRounds, metrics, completedDate).
 *
 * Invocation from the target project root:
 *   npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts
 *
 * Read-only: emits a markdown report to stdout. DOES NOT modify target files.
 * Use the report to drive a migration plan — the migrate-roadmap skill walks
 * through the remediation, or do it manually.
 *
 * Lives in the plugin directory (never copied to target repos by
 * scaffold-roadmap.sh), so it stays disposable.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ── Types ──────────────────────────────────────────────────────────────────

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

interface ArtifactCheck {
  path: string
  exists: boolean
  canonicalAvailable: boolean
}

interface PhaseIssue {
  severity: Severity
  issue: string
}

interface PhaseScan {
  file: string
  phaseNumber: number | null
  status: string | null
  issues: PhaseIssue[]
}

// ── Arg parsing ────────────────────────────────────────────────────────────

function parseArgs(): { projectDir: string } {
  const args = process.argv.slice(2)
  const projectIdx = args.findIndex((a) => a === '--project')
  const projectDir =
    projectIdx >= 0 && args[projectIdx + 1] ? path.resolve(args[projectIdx + 1]) : process.cwd()
  return { projectDir }
}

// ── Canonical paths (relative to this script) ──────────────────────────────

const SCRIPT_DIR = __dirname
const PLUGIN_DIR = path.resolve(SCRIPT_DIR, '..', '..')
const CANONICAL_SCHEMA = path.join(PLUGIN_DIR, 'templates', 'schema.ts')

// ── Schema feature detection (text-based — robust to minor formatting diffs) ─

function readIfExists(p: string): string | null {
  if (!fs.existsSync(p)) return null
  return fs.readFileSync(p, 'utf8')
}

function detectFeatures(content: string | null): Record<string, boolean> {
  if (!content) {
    return {
      discriminatedUnion: false,
      passingGateResultShape: false,
      transparencyReportShape: false,
      gateFindingShape: false,
      structuredGateRound: false,
      taskLevelDependsOn: false,
      phaseLevelCompromises: false,
      phaseKind: false,
      taskBatchMode: false,
      backlogTiers: false,
      debtResolutions: false,
    }
  }

  const taskShapeBlock = findBlock(content, /\bPhaseTaskShape\s*=\s*z\.object\(\{/)
  const basePhaseBlock =
    findBlock(content, /\bBasePhaseFields\s*=\s*\{/) ??
    findBlock(content, /\bBasePhaseFields\s*=\s*z\.object\(\{/) ??
    findBlock(content, /\bPhaseShape\s*=\s*z\.object\(\{/)

  return {
    discriminatedUnion:
      content.includes("discriminatedUnion('status'") ||
      content.includes('discriminatedUnion("status"'),
    passingGateResultShape: /\bPassingGateResultShape\b/.test(content),
    transparencyReportShape: /\bTransparencyReportShape\b/.test(content),
    gateFindingShape: /\bGateFindingShape\b/.test(content),
    structuredGateRound: /\bStructuredGateRoundShape\b/.test(content),
    taskLevelDependsOn:
      taskShapeBlock !== null && /dependsOn:\s*z\.array\(z\.string/.test(taskShapeBlock),
    phaseLevelCompromises:
      basePhaseBlock !== null && /\bcompromises:\s*z\.string\(\)/.test(basePhaseBlock),
    phaseKind:
      basePhaseBlock !== null &&
      /\bkind:\s*z\.enum\(\[\s*['"]mockup['"]/.test(basePhaseBlock),
    taskBatchMode:
      taskShapeBlock !== null && /\bbatchMode:\s*z\.boolean\(\)/.test(taskShapeBlock),
    backlogTiers: /\bBacklogTierShape\b/.test(content),
    debtResolutions:
      basePhaseBlock !== null && /\bdebtResolutions:\s*z\.array\(/.test(basePhaseBlock),
  }
}

/** Find the first bracket-balanced block that starts at / after `startRegex`
 *  and return the full match span (from `startRegex.index` through the closing
 *  char). Defaults to `{}` but can balance `[]` or any other pair. Used for
 *  `z.object({ ... })`, `{ ... } as const`, and `gateRounds: [ ... ]`. */
function findBlock(
  content: string,
  startRegex: RegExp,
  openChar = '{',
  closeChar = '}',
): string | null {
  const match = startRegex.exec(content)
  if (!match) return null
  const start = match.index
  const openIdx = content.indexOf(openChar, start)
  if (openIdx < 0) return null
  let depth = 0
  for (let i = openIdx; i < content.length; i++) {
    const c = content[i]
    if (c === openChar) depth++
    else if (c === closeChar) {
      depth--
      if (depth === 0) return content.slice(start, i + 1)
    }
  }
  return null
}

// ── Steady-state artifact check ────────────────────────────────────────────

const REQUIRED_ARTIFACTS: Array<{ target: string; canonical: string | null }> = [
  { target: 'lib/roadmap/schema.ts', canonical: 'templates/schema.ts' },
  { target: 'lib/roadmap/registry.ts', canonical: 'templates/registry.ts' },
  { target: 'lib/roadmap/emit.ts', canonical: 'templates/emit.ts' },
  { target: 'roadmap/ROADMAP.md', canonical: 'templates/ROADMAP.md' },
  { target: 'roadmap/backlog.ts', canonical: 'templates/backlog.ts' },
  { target: 'scripts/pre-review.sh', canonical: 'scripts/pre-review.sh' },
  { target: 'scripts/collect-phase-metrics.ts', canonical: 'scripts/collect-phase-metrics.ts' },
  { target: 'scripts/build-dashboard.sh', canonical: 'scripts/build-dashboard.sh' },
  { target: 'scripts/generate-changelog-md.ts', canonical: 'scripts/generate-changelog-md.ts' },
]

function checkArtifacts(projectDir: string): ArtifactCheck[] {
  return REQUIRED_ARTIFACTS.map((a) => ({
    path: a.target,
    exists: fs.existsSync(path.join(projectDir, a.target)),
    canonicalAvailable: a.canonical
      ? fs.existsSync(path.join(PLUGIN_DIR, a.canonical))
      : false,
  }))
}

// ── Phase file compatibility scan ──────────────────────────────────────────

function listPhaseFiles(projectDir: string): string[] {
  const dir = path.join(projectDir, 'roadmap', 'phases')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.phase.ts'))
    .map((f) => path.join(dir, f))
    .sort()
}

function scanPhaseFile(filePath: string): PhaseScan {
  const text = fs.readFileSync(filePath, 'utf8')
  const issues: PhaseIssue[] = []

  const phaseMatch = text.match(/^\s*phase:\s*(\d+)\s*,/m)
  const phaseNumber = phaseMatch ? Number.parseInt(phaseMatch[1], 10) : null

  const statusMatch = text.match(/\bstatus:\s*['"](\w[\w-]*)['"]/m)
  const status = statusMatch?.[1] ?? null

  // Schema v3: every phase must declare `kind`. Applies to ALL statuses —
  // legacy phases predating v3 need backfill before do-phase can select the
  // right gate set. Scan before the done-only early return.
  if (!/\bkind:\s*['"](mockup|logic|hardening|release)['"]/.test(text)) {
    issues.push({
      severity: 'HIGH',
      issue: `missing kind field — backfill suggested: ${suggestKind(text)}`,
    })
  }

  if (status !== 'done') {
    return { file: filePath, phaseNumber, status, issues }
  }

  // From here: status === 'done'. Apply strict DonePhaseShape checks.
  const hasGate = /\bgate:\s*\{/.test(text)
  if (!hasGate) {
    issues.push({
      severity: 'HIGH',
      issue: "done phase missing `gate: { ... }` — strict DonePhaseShape requires it",
    })
  } else {
    const tcMatch = text.match(/typeCheck:\s*['"](\w+)['"]/)
    if (tcMatch && tcMatch[1] !== 'clean') {
      issues.push({
        severity: 'HIGH',
        issue: `gate.typeCheck is '${tcMatch[1]}' — strict DonePhase requires literal 'clean'`,
      })
    }
    const lintMatch = text.match(/\blint:\s*['"](\w+)['"]/)
    if (lintMatch && lintMatch[1] === 'errors') {
      issues.push({
        severity: 'HIGH',
        issue: "gate.lint is 'errors' — strict DonePhase allows only 'clean' | 'warnings'",
      })
    }
    // unitTests passed === total
    const unitBlock = extractBalanced(text, /unitTests:\s*\{/)
    if (unitBlock) {
      const p = unitBlock.match(/passed:\s*(\d+)/)
      const t = unitBlock.match(/total:\s*(\d+)/)
      if (p && t && p[1] !== t[1]) {
        issues.push({
          severity: 'HIGH',
          issue: `gate.unitTests ${p[1]}/${t[1]} — strict DonePhase requires passed === total`,
        })
      }
    }
  }

  // Use bracket-balanced extraction so descriptions containing `arr[0]` don't
  // terminate the match at the first inner `]`.
  const gateRoundsBlock = findBlock(text, /gateRounds:\s*\[/, '[', ']')
  if (!gateRoundsBlock) {
    issues.push({
      severity: 'HIGH',
      issue: 'done phase missing `gateRounds: [...]` — strict DonePhase requires ≥1 entry',
    })
  } else {
    const bracketOpen = gateRoundsBlock.indexOf('[')
    const inner = gateRoundsBlock.slice(bracketOpen + 1, gateRoundsBlock.length - 1)
    if (inner.trim() === '') {
      issues.push({
        severity: 'HIGH',
        issue: '`gateRounds: []` is empty — strict DonePhase requires ≥1 entry',
      })
    }
  }

  if (!/\bmetrics:\s*\{/.test(text)) {
    issues.push({
      severity: 'HIGH',
      issue: 'done phase missing `metrics: { ... }` — strict DonePhase requires it',
    })
  }

  if (!/\bcompletedDate:\s*['"]/.test(text)) {
    issues.push({
      severity: 'HIGH',
      issue: "done phase missing `completedDate: 'YYYY-MM-DD'` — strict DonePhase requires it",
    })
  }

  return { file: filePath, phaseNumber, status, issues }
}

/** Heuristic backfill for the kind field on legacy phases. Reads category and
 *  stakeholderDemo from the phase text and returns the most likely kind value.
 *  Order matters — the first matching rule wins.
 *
 *  Prose mirror: skills/audit-roadmap/SKILL.md Check 9. Keep these in sync —
 *  if you edit one, edit the other. */
function suggestKind(text: string): 'mockup' | 'logic' | 'hardening' | 'release' {
  const cat = text.match(/\bcategory:\s*['"](\w+)['"]/)?.[1] ?? ''
  const demo = text.match(/\bstakeholderDemo:\s*['"]([^'"]+)['"]/)?.[1]?.toLowerCase() ?? ''

  const isUI = /\b(screen|page|design|dashboard|branding|layout|copy|dark[- ]?mode|landing|wizard)\b/.test(demo)
  const isRelease = /\b(release|version|ship|cut|hotfix)\b/.test(demo)

  if (cat === 'fix' || cat === 'refactor') return 'hardening'
  if (cat === 'infra' && isRelease) return 'release'
  if (cat === 'feature' && isUI) return 'mockup'
  return 'logic'
}

/** Find the first `{` matching the opening pattern and return the balanced block. */
function extractBalanced(text: string, opening: RegExp): string | null {
  const match = opening.exec(text)
  if (!match) return null
  const open = match.index + match[0].length - 1 // position of `{`
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(open, i + 1)
    }
  }
  return null
}

// ── Report rendering ───────────────────────────────────────────────────────

function renderReport(args: {
  projectDir: string
  targetFeatures: Record<string, boolean>
  canonicalFeatures: Record<string, boolean>
  artifacts: ArtifactCheck[]
  phaseScans: PhaseScan[]
}): string {
  const { projectDir, targetFeatures, canonicalFeatures, artifacts, phaseScans } = args
  const now = new Date().toISOString().slice(0, 10)

  const featureRows = [
    ['discriminatedUnion', 'PhaseShape uses discriminatedUnion(\'status\') for strict done variant'],
    ['passingGateResultShape', 'Strict gate variant requiring typeCheck clean + unitTests passed===total'],
    ['transparencyReportShape', 'Structured WHAT/HOW/COMPROMISES/SKIPPED/HARDCODED/LIMITATIONS per task'],
    ['gateFindingShape', 'Structured {file, line, severity, confidence, description} per finding'],
    ['structuredGateRound', 'StructuredGateRoundShape — findings attached to each round'],
    ['taskLevelDependsOn', 'PhaseTaskShape.dependsOn: string[] for intra-phase task DAG'],
    ['phaseLevelCompromises', 'Phase.compromises — aggregated summary survives outside commit body'],
    ['phaseKind', 'Phase.kind — mockup/logic/hardening/release drives gate selection (schema v3)'],
    ['taskBatchMode', 'PhaseTask.batchMode — opt-in for mechanical multi-commit tasks (schema v4)'],
    ['backlogTiers', 'Backlog accepts tiered { tiers: [{ tier, label, items }] } form (schema v5)'],
    ['debtResolutions', 'Phase.debtResolutions — closed-debt log pointing at transparencyReport entries (schema v6)'],
  ]

  let schemaSection = ''
  let behind = 0
  for (const [key, summary] of featureRows) {
    const canon = canonicalFeatures[key]
    const target = targetFeatures[key]
    const mark = target ? '✅' : canon ? '❌' : '—'
    if (canon && !target) behind++
    schemaSection += `- ${mark} **${key}** — ${summary}\n`
  }

  let schemaVerdict = 'UNKNOWN'
  if (!fs.existsSync(path.join(projectDir, 'lib', 'roadmap', 'schema.ts'))) {
    schemaVerdict = 'NO SCHEMA — fresh scaffold recommended'
  } else if (behind === 0) {
    schemaVerdict = 'CURRENT'
  } else if (behind <= 3) {
    schemaVerdict = `${behind} features behind — additive upgrade (low risk)`
  } else {
    schemaVerdict = `${behind} features behind — structural upgrade (plan carefully)`
  }

  const artifactRows = artifacts
    .map((a) => {
      const mark = a.exists ? '✅' : '❌'
      const src = a.canonicalAvailable ? '' : ' (no canonical — skip)'
      return `- ${mark} \`${a.path}\`${src}`
    })
    .join('\n')
  const missingArtifacts = artifacts.filter((a) => !a.exists && a.canonicalAvailable)

  const doneScans = phaseScans.filter((s) => s.status === 'done')
  const breakingScans = doneScans.filter((s) => s.issues.length > 0)

  const breakingSection = breakingScans.length
    ? breakingScans
        .map(
          (s) =>
            `### phase-${s.phaseNumber ?? '?'} (\`${path.basename(s.file)}\`)\n` +
            s.issues.map((i) => `  - **${i.severity}** ${i.issue}`).join('\n'),
        )
        .join('\n\n')
    : '_No breaking issues detected in done phases._'

  const missingKindScans = phaseScans.filter((s) =>
    s.issues.some((i) => i.issue.startsWith('missing kind field')),
  )
  const missingKindSection = missingKindScans.length
    ? missingKindScans
        .map((s) => {
          const issue = s.issues.find((i) => i.issue.startsWith('missing kind field'))
          return `- phase-${s.phaseNumber ?? '?'} (\`${path.basename(s.file)}\`, status: ${s.status ?? '?'}) — ${issue?.issue ?? ''}`
        })
        .join('\n')
    : '_All phases declare `kind`._'

  const statusCounts = phaseScans.reduce<Record<string, number>>((acc, s) => {
    const k = s.status ?? 'unknown'
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})

  const nextSteps = buildNextSteps({
    schemaVerdict,
    missingArtifacts,
    breakingCount: breakingScans.length,
    totalDone: doneScans.length,
    targetSchemaExists: fs.existsSync(path.join(projectDir, 'lib', 'roadmap', 'schema.ts')),
    missingKindCount: missingKindScans.length,
  })

  return `# Roadmap Migration Audit — ${now}

**Target project**: \`${projectDir}\`
**Canonical plugin**: \`${PLUGIN_DIR}\`

## 1. Schema version

Verdict: **${schemaVerdict}**

${schemaSection}
## 2. Steady-state artifacts

${artifactRows}

${missingArtifacts.length ? `**Missing: ${missingArtifacts.length} file(s)**` : '_All required files present._'}

## 3. Phase files

Total scanned: ${phaseScans.length}
- ${Object.entries(statusCounts)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ')}

Done phases with strict-fail issues: **${breakingScans.length}** of ${doneScans.length}

${breakingSection}

### Phases missing \`kind\` (schema v3 backfill)

${missingKindSection}

## 4. Recommended next steps

${nextSteps}

---

_This audit is read-only. No files were modified. Apply the steps above in order — schema first, missing scripts next, strict-fail phase files last. Tell Claude "migrate the roadmap" to drive the remediation interactively._
`
}

function buildNextSteps(args: {
  schemaVerdict: string
  missingArtifacts: ArtifactCheck[]
  breakingCount: number
  totalDone: number
  targetSchemaExists: boolean
  missingKindCount: number
}): string {
  const steps: string[] = []

  if (!args.targetSchemaExists) {
    steps.push(
      '**Fresh scaffold** — no existing schema detected. Run:\n' +
        '   ```bash\n' +
        '   bash ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-roadmap.sh\n' +
        '   ```',
    )
    return steps.map((s, i) => `${i + 1}. ${s}`).join('\n\n')
  }

  if (args.schemaVerdict !== 'CURRENT') {
    steps.push(
      '**Upgrade `lib/roadmap/schema.ts`** to the canonical version. Diff your current schema against ' +
        '`${CLAUDE_PLUGIN_ROOT}/templates/schema.ts`. All new shapes (TransparencyReportShape, ' +
        'GateFindingShape, StructuredGateRoundShape, task dependsOn, phase compromises) are **additive** ' +
        'with defaults — if you already have the discriminated union + PassingGateResultShape, the upgrade ' +
        'is copy-paste-safe. If not, adopting the discriminated union is the structural step — done phases ' +
        'without a complete `gate/gateRounds/metrics/completedDate` will fail to parse until fixed.',
    )
  }

  if (args.missingArtifacts.length > 0) {
    const list = args.missingArtifacts.map((a) => `\`${a.path}\``).join(', ')
    steps.push(
      `**Copy missing scripts** — ${list}. Each canonical copy lives under ` +
        '`${CLAUDE_PLUGIN_ROOT}/scripts/` or `${CLAUDE_PLUGIN_ROOT}/templates/`. ' +
        'Copy only the files you need; `scaffold-roadmap.sh` is idempotent and skips existing files.',
    )
  }

  if (args.breakingCount > 0) {
    steps.push(
      `**Reconcile ${args.breakingCount} done phase(s)** flagged in section 3. Three options per phase:\n` +
        '   - Run `npx tsx scripts/collect-phase-metrics.ts <N>` to backfill gate + metrics from git history.\n' +
        '   - Fill the missing fields manually using data from the phase\'s commits.\n' +
        '   - Downgrade the phase to `status: \'cancelled\'` if the completion claim was premature.\n' +
        '   Pick one per phase; the audit makes no assumption.',
    )
  }

  if (args.missingKindCount > 0) {
    steps.push(
      `**Backfill \`kind\` on ${args.missingKindCount} phase(s)** flagged in section 3. Schema v3 ` +
        'requires every phase to declare `kind` (mockup | logic | hardening | release) — it drives ' +
        'gate selection in `do-phase`. The audit suggests a value per phase based on category and ' +
        'stakeholderDemo heuristics; treat it as a starting point, not gospel. When in doubt between ' +
        '`logic` and `hardening`, pick `hardening` — the cost of one extra integration rerun is far ' +
        'less than shipping an unverified persistence fix.',
    )
  }

  if (steps.length === 0) {
    steps.push('No migration needed. Your roadmap is on the latest plugin version.')
  }

  return steps.map((s, i) => `${i + 1}. ${s}`).join('\n\n')
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const { projectDir } = parseArgs()

  if (!fs.existsSync(projectDir)) {
    console.error(`Project directory not found: ${projectDir}`)
    process.exit(2)
  }

  const canonicalContent = readIfExists(CANONICAL_SCHEMA)
  const targetContent = readIfExists(path.join(projectDir, 'lib', 'roadmap', 'schema.ts'))

  const canonicalFeatures = detectFeatures(canonicalContent)
  const targetFeatures = detectFeatures(targetContent)
  const artifacts = checkArtifacts(projectDir)
  const phaseScans = listPhaseFiles(projectDir).map(scanPhaseFile)

  const report = renderReport({
    projectDir,
    targetFeatures,
    canonicalFeatures,
    artifacts,
    phaseScans,
  })

  process.stdout.write(report)
}

main()
