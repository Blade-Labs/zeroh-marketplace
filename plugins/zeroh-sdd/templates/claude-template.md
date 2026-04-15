# Project Behavioral Contract

> Copy this file to your project's `CLAUDE.md` for battle-tested LLM behavioral rules.
> Customize the sections below for your project's domain and conventions.

---

## Prime Directive: Errors Are The Debugging Interface

**SURFACING HELPFUL DEBUG ERRORS IS THE SINGLE MOST VALUABLE THING YOU CAN DO.**

This is LLM-driven development. When something breaks, the user pastes the error into an LLM. The LLM reads it and fixes the problem in seconds. That is the entire debugging workflow.

**Every fallback you write destroys this.** "Data not available" — unfixable. "Something went wrong" — unfixable. The actual error with the actual status code and the actual path and what to do about it — fixable in 30 seconds.

**Three absolutes:**
1. The actual error reaches the user. Not a summary. Not your interpretation.
2. Every error includes remediation. What to run, what to check, what is missing.
3. One error shape, one trace system. No ad-hoc helpers.

---

## Anti-Patterns

### AP: Commit Batching
Commit after EACH logical unit of work. One file moved = commit. One module created = commit.
After compaction, you recover via `git log`. Batched commits = lost decisions = repeated work.

### AP: Premature Completion
Never declare complete without verification. Run actual commands, not just review code.
Only declare done when: all requirements addressed, code tested, validation passes, no open TODOs.

### AP: Creating Parallel Systems
Search first. Extend existing. Only create if nothing found.
Don't create new file when existing could be extended.
Don't use manual approach when scaffolder exists.

### AP: Test Capitulation
NEVER weaken a test to make it pass. Fix the code, not the test.
Changing `toThrow()` to `toBeUndefined()` is capitulation.
Removing a test to fix lint is capitulation.
"29/30 is close enough" is capitulation.

### AP: Error Hiding
Never return null from a catch block. Never create "handleError" helpers that swallow context.
The raw upstream error IS the fix. The "clean" message is the trap.

### AP: Distrusting Tool Errors
Trust operations (mv, git add — they error on failure). Verify claims (grep before asserting code exists at line X).

### AP: Creating Islands
New infrastructure must connect to existing systems. Orphaned utilities become dead code within weeks.

---

## Commit Hygiene

```
type(scope): what changed

WHY: problem/context — explain the gap being closed

IMPACT: what improves
```

Types: feat, fix, docs, refactor, test, chore
One logical change per commit. Push regularly.

---

## Workflow Protocol

1. **SURFACE** your understanding and plan
2. **WAIT** for explicit approval
3. **EXECUTE** atomically (work → commit → report)
