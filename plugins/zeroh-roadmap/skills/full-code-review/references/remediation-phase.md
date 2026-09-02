# Remediation Phase File

Write `<root>/phases/phase-<N>.phase.ts` (`<N>` from `roadmap claim`). Match
the `definePhase` import style of an existing file in `<root>/phases/` — the
schema module is `<root>/lib/schema.ts` but consumers alias it differently.

```typescript
import { definePhase } from '<match existing phase files>'

export default definePhase({
  phase: <N>,
  name: 'Code Review Remediation',
  status: 'backlog',
  category: 'fix',
  source: 'Full code review (<YYYY-MM-DD>)',
  priority: '<BLOCKER if any critical | HIGH if only high | MEDIUM otherwise>',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [/* top files from the findings */],
  stakeholderDemo:
    'All findings from the <YYYY-MM-DD> full code review are resolved and re-verified.',
  tasks: [
    {
      id: '<N>.1',
      title: '<group label, e.g. Fix critical auth findings>',
      problem: '<why these findings matter and what breaks while they stand>',
      steps: [
        { file: 'path/to/file.ts', description: 'FCR-1: <finding + fix>' },
        { file: 'path/to/file.ts', description: 'FCR-2: <finding + fix>' },
      ],
      acceptanceCriteria: ['<observable outcome>'],
      files: ['path/to/file.ts'],
      done: false,
    },
    // ...one task block per finding group...
    {
      id: '<N>.<last>',
      title: 'Run validation gate and re-review',
      problem:
        'Remediation counts as complete only when independently re-verified: gate green plus a clean re-review.',
      steps: [
        { file: '<root>/roadmap.config.json', description: 'Run the gateCommands slots (roadmap gate run <N>)' },
        { file: 'reviews/', description: 'Re-run full-code-review; require zero critical/high findings' },
      ],
      acceptanceCriteria: ['All gate slots pass', 'Re-review reports zero critical/high findings'],
      files: ['<root>/roadmap.config.json'],
      done: false,
    },
  ],
})
```

## Grouping rules

- Critical findings first: one task per domain (e.g. auth, data integrity,
  domain calculations).
- High findings next, grouped by domain (dead code, architecture, performance).
- Medium findings grouped by file/area; low findings in one final cleanup task.
- Size limits are schema-enforced, not stylistic: `roadmap phase validate <N>`
  refuses tasks with more than 6 steps or 10 files unless `batchMode: true`,
  and `acceptanceCriteria` caps at 4 per task (`PhaseTaskShape`,
  `<root>/lib/schema.ts`). Split tasks rather than reaching for batchMode.
- Every step description starts with its FCR id — the id chain from report to
  record to task is the audit trail.

## Commit

```bash
git add <root>/phases/phase-<N>.phase.ts
git commit -m "docs(roadmap): phase <N> — code review remediation from <YYYY-MM-DD> audit"
```

Stage explicit paths only; shared checkouts carry sibling dirt.
