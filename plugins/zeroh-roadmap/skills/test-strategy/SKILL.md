---
name: "Test Strategy"
description: "Test pyramid, coverage targets, and conventions. Use when writing tests, reviewing test quality, or planning test phases."
user-invocable: true
metadata:
  keywords: test, vitest, coverage, unit, integration, e2e, playwright, allure
---

# Test Strategy

**Full document:** Check project docs for a test strategy document.

## Test Pyramid

| Tier | What | Runner | Count | Runtime |
|------|------|--------|-------|---------|
| 1a — Unit | Pure business logic, no mocking | vitest | ~900 | ~3s |
| 1b — Integration | Mocked DB/email, route orchestration | vitest | ~400 | ~5s |
| 2 — E2E | User journeys, all 9 roles | Playwright | ~100 | ~7min |

## Commands

```bash
pnpm test              # All Tier 1 (~4s, offline)
pnpm test:coverage     # With v8 coverage
pnpm test:allure       # With Allure HTML report
```

## Conventions

- Tests in `__tests__/` directories next to source
- `describe('module') > describe('function') > it('scenario — edge case')`
- Mock at sub-module boundary, not at drizzle layer
- `beforeEach(() => vi.resetAllMocks())` in every file
- Financial assertions: exact integers or `toBeCloseTo` with explicit precision
- Time-dependent: `vi.useFakeTimers()` + `vi.useRealTimers()` in afterEach

## DB Mock Factory (`lib/__tests__/db-mock-factory.ts`)

Shared Drizzle mock with argument capture. Use for all new test files that mock `@/lib/db/drizzle`.

### Setup pattern (handles vi.mock hoisting)

```typescript
import type { DrizzleMockCapture } from '@/lib/__tests__/db-mock-factory'

const ref = vi.hoisted(() => ({ db: null as any, mocks: null as any }))
vi.mock('@/lib/db/drizzle', async () => {
  const { createDrizzleMock } = await import('@/lib/__tests__/db-mock-factory')
  const result = createDrizzleMock()
  ref.db = result.db
  ref.mocks = result.mocks
  return { db: result.db }
})
function getMocks(): DrizzleMockCapture { return ref.mocks }
```

### Providing select results (FIFO queue)

```typescript
// Each push = one await db.select()... call
getMocks().selectQueue.push([{ id: '1', name: 'Cycle A' }])
getMocks().selectQueue.push([])  // empty result for second query
```

### Asserting insert/update payloads

```typescript
// After code under test runs:
expect(getMocks().insertPayloads[0]).toMatchObject({
  event_type: 'CAPITAL_DEPLOYED',
  data: expect.objectContaining({ amount: 50000 }),
})

expect(getMocks().updatePayloads[0]).toMatchObject({
  status: 'closed',
})
```

### When to use argument capture vs simple call verification

| Scenario | Approach |
|----------|----------|
| Verifying correct event type/data sent to DB | `insertPayloads[0].event_type` |
| Verifying a side-effect happened at all | `insertCalled` flag |
| Verifying specific WHERE conditions | `whereConditions` array |
| Verifying no DB write occurred | `insertPayloads.length === 0` |

## Coverage Targets

| Risk Tier | Target |
|-----------|--------|
| Financial calculations | 90%+ |
| Business rules | 90%+ |
| Auth/security | 80%+ |
| Disclosure | 80%+ |

## Quality Bar

- Tests enforce INVARIANTS, not just outputs
- No test capitulation (changing tests to match broken behavior)
- No no-op assertions (`toBeDefined()` on always-defined values)
- No conditional assertions wrapped in `if` blocks

## E2E Rules & Patterns

E2E rules (real-user-flow principle, selector priority, spec file structure) are defined in the "E2E Test Rules" section of `CLAUDE.md` — the single source of truth.

Implementation patterns (step functions, code examples, file references) are in `.claude/agents/e2e-test-writer.md`.
