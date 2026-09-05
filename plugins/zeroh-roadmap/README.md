# ZeroH Roadmap

Phase-driven development for AI-assisted teams. Break work into phases, execute one task at a time, validate with review agents, generate audit reports.

**Requires:** TypeScript project with `zod` in dependencies.

## Why

Long-context LLM sessions degrade. Decisions get forgotten, work gets re-done, Claude declares "all done!" after 3 of 5 tasks. This plugin solves it by giving every session a phase file that says exactly what to do, in what order, with what acceptance criteria. Two review agents validate the result. Zero findings to pass.

New here? Read [docs/orientation.html](docs/orientation.html) — a ten-minute engineer's orientation explaining what this is, how the lifecycle works, and how it compares to prompt-discipline frameworks like superpowers.

## Install

```bash
claude plugin install zeroh-roadmap
```

Run `roadmap init` to scaffold the roadmap infrastructure. When project homes are missing, install `zeroh-greenfield` and use its `brownfield-audit` workflow as directed by `using-zeroh-roadmap/references/layout.md §Missing homes`.

## Get started

After install, start your first session and say:

> "create a phase for adding user authentication"

The plugin reads your code, identifies the specific files and changes needed, and writes a typed phase file. Then say `do phase 1` and watch it execute.

## Usage

| What you say | What happens |
|-------------|-------------|
| "create phase for X" | Reads the code, identifies specific files + changes, writes `phase-N.phase.ts` |
| "do phase 5" | Executes tasks one at a time, commits each, runs validation gate, reports compromises |
| "review phase 5" | Verifies claimed work actually happened — checks code, not just commit messages |
| "what's in the roadmap?" | Lists backlog by priority, shows in-progress and recent done phases |
| "can phases 5 and 7 run parallel?" | Checks if key files overlap — if no, two sessions can work simultaneously |
| "run full code review" | 8 specialist agents audit the codebase — required before release |

## How it works

```
/plan-phase    → reads code, creates phase-N.phase.ts (backlog)
/do-phase N    → one task at a time, commit between each, gate at the end
/review-phase N → verify the work was done correctly

# Arc lifecycle (a named block of phases shipped as one unit)
/plan-arc      → author the Arc + design-first gate (reuse-or-design the architecture & UX, confirmed) → plan phases against the design (parallel review)
/do-arc <id>   → build every phase in order, then the pre-merge sweep + intent validation
/arc-sweep     → dispose arc debt + whole-arc seam + design-conformance review before merge
/validate-arc  → drive the real flow + an independent judge vs the acceptance criteria
```

The arc lifecycle is a **design → build → validate** loop: `plan-arc`'s **design-first gate** (Step 1b) classifies the arc and, for a new pattern or a surface, has the `software-architect` (architecture) and the `ux-designer` (UX) reuse an existing design or design a new one — confirmed by you — and records it as the arc's `designRefs`. Phases then plan and build *against* that confirmed design, and `arc-sweep` judges the build's conformance to it.

Each phase is a `.phase.ts` file with typed tasks. The plugin creates them for you — you describe what you want, it reads the code and writes the phase:

```typescript
export default definePhase({
  phase: 5,
  name: 'Add rate limiting to public endpoints',
  status: 'backlog',
  priority: 'HIGH',
  tasks: [
    {
      id: '5.1',
      title: 'Add rate limiter middleware to login route',
      problem: 'Login endpoint has no rate limiting — brute force possible.',
      steps: [{ file: 'middleware.ts', description: 'Add sliding window rate check' }],
      acceptanceCriteria: ['10 requests/min limit enforced, 429 returned on 11th'],
      files: ['middleware.ts'],
      done: false,
    },
  ],
})
```

### Validation gate (runs automatically after every phase)

1. Lint
2. Type-check
3. Tests
4. Build
5. Code review — 2 parallel agents, >=80% confidence filter
6. Fix all findings → loop until zero

No exceptions. No "this phase is low-risk." Every phase gets the full gate. A typical gate takes 2-4 minutes and ~150k tokens (2 agents, 1-2 rounds).

### Review reports

Each release produces `reviews/releases/v{version}-review.json` — gate results, agent findings per round, resolution status, verdict. Build the HTML dashboard: `bash scripts/build-dashboard.sh`

## What gets created in your project

`roadmap init [--root <dir>]` scaffolds the tree below under `<root>` — `roadmap` by default,
`docs/roadmap` for a repo that keeps its workflows as sibling doc folders. The root is then
DISCOVERED, never configured (`ROADMAP_ROOT` overrides; a repo carrying both candidates is
refused by name). Existing consumers with the legacy toplevel `lib/roadmap/schema.ts` seam are
untouched — it stays recognized. Full rules:
`skills/using-zeroh-roadmap/references/layout.md`.

| Path | Purpose |
|------|---------|
| `<root>/lib/schema.ts` | `definePhase()` + `defineBacklog()` with Zod validation (flat or tiered backlog input — see `<root>/backlog.ts`) |
| `<root>/lib/registry.ts` | Phase discovery (glob + dynamic import + duplicate detection) |
| `<root>/lib/emit.ts` | Changelog emission from `.phase.ts` files |
| `<root>/phases/` | Where `.phase.ts` files live (each imports `../lib/schema`) |
| `<root>/ROADMAP.md` | Gate protocol + git strategy |
| `reviews/releases/` | Release review report JSONs |
| `scripts/pre-review.sh` | Automated checks (catches 40% of findings before agents) |
| `scripts/build-dashboard.sh` | Self-contained HTML review dashboard |
| `scripts/generate-changelog-md.ts` | Changelog from phase data |

## Skills reference

| Skill | Trigger |
|-------|---------|
| `/do-phase N` | Execute phase — sequential tasks, commits, transparency reports, gate |
| `/plan-phase` | Create phase — reads code first, writes specific tasks with file paths |
| `/review-phase N` | Verify phase — checks code matches claims, finds missed patterns |
| `/code-review` | Review code — confidence-filtered, >=80% only |
| `/full-code-review` | Pre-release — 8 parallel agents (security, dead code, DRY, perf, arch, edge cases, data flow, domain) |
| `/test-strategy` | Test conventions — pyramid, coverage targets, quality bar |
| `/audit-roadmap` | Audit roadmap — read-only structural consistency checks |
| `/release-sweep <version>` | Release prep — dispose outstanding debts, optionally archive |
| `/plan-arc` | Plan arc — author the Arc + design-first gate (reuse-or-design the architecture & UX, confirmed), then plan phases against the design (parallel review) |
| `/do-arc <id>` | Execute arc — build every phase in order, serialize mutation, end in the pre-merge sweep + intent validation |
| `/arc-sweep` | Pre-merge sweep — dispose arc debt + whole-arc seam + design-conformance review |
| `/validate-arc <id>` | Terminal intent gate — drive the arc's real flow + an independent `intent-validator` judge against its acceptance criteria; PASS/GAPS + a bounded corrective loop |
| `using-zeroh-roadmap` | Always-active router — dispatches the requests above to the right skill |

## Multi-platform

Works on Claude Code, Cursor, GitHub Copilot, Gemini CLI, and Codex.

## License

Apache 2.0 — See [LICENSE](LICENSE)
