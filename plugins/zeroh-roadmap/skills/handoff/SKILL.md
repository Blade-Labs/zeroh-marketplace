---
name: "handoff"
description: "Routes unfinished session context into durable roadmap artifacts, leaving only justified residue for a fresh session. Use for requests to hand off work, hand off to a fresh session, continue in a new session, write a context file, or produce a one-line prompt."
---

# Handoff

Route context into typed roadmap artifacts before writing `.building/HANDOFF.md`. Treat the handoff as residue, not as a second plan.

Ground this workflow in the 2026-08-23 session-continuity survey that established the three routing cases handled here; `evals/evals.json` records those three cases as scenarios.

Not this skill: `do-arc` owns execution-loop pauses and its optional `<root>/arcs/<ID>-RESUME.md` notes; `handoff` owns cross-session context routing and `.building/HANDOFF.md`. Never duplicate residue between them.

## 1. Inspect the repository

1. Run `roadmap status` and inspect the active `<root>/phases/phase-<N>.phase.ts` and `<root>/arcs/<ID>.arc.ts` files named by it.
2. Run `git status --short` and `git rev-parse HEAD`; record uncommitted paths and the exact HEAD SHA.
3. If a phase file already carries the doing, state, or next action, refuse to duplicate those facts in `.building/HANDOFF.md`. Say which phase owns them, then continue only with context that has no typed home.
4. If `roadmap status` fails or a named roadmap file is unreadable, STOP and report the failing command; do not invent repository state.

## 2. Route durable context first

Classify every candidate item and edit its owner before considering residue. Use this progress checklist so no item silently falls through.

| Done | Candidate context | Durable owner |
| --- | --- | --- |
| [ ] | Design reasoning or learned code facts | The relevant phase's `notes` |
| [ ] | A load-bearing executable tripwire | The relevant phase's `assumptions[]` |
| [ ] | A ratified ruling spanning an arc | The arc's `LOCKED DECISIONS` block |
| [ ] | A durable cross-project fact | The operator vault, only when the repository binds one |
| [ ] | A durable lesson from an error, correction, or surprising re-derivation | `roadmap eval lesson "<lesson>" --writer <model-id> [--phase <N>]` |

Commit edits to phase and arc files: those commits are the durable handoff. If an item could fit more than one owner, choose the narrowest artifact whose lifecycle matches it. If no owner is identifiable, classify it as unclear residue and name who must decide.

## 3. Refuse duplication, then classify residue

Keep only these measured residue classes in the handoff:

- A scope fence that constrains work across phases.
- Cross-phase intent such as release framing.
- Mid-flight uncommitted state: exact SHAs, live background tasks, or artifact URLs.
- An unclear item that names whom it awaits.
- An ephemeral gotcha that would be wrong or noisy in a durable artifact.

For every retained line, append `Why not routable: <reason>`. A missing reason means the item is not eligible for the handoff; route it or omit it. NEVER copy phase-owned doing, state, or next actions into the handoff; this is enforced by the phase-in-flight refusal in step 1 and is otherwise honor-system.

If routing leaves no residue, do not create `.building/HANDOFF.md`. Proceed directly to the pure invocation in step 5.

## 4. Write the strict handoff

Read `references/template.md` now and preserve its headings and header fields exactly. Write `.building/HANDOFF.md` by default. For `--name <slug>`, where `<slug>` contains lowercase letters, digits, and hyphens, write `.building/handoff-<slug>.md` and list it under `Siblings` in the default handoff when that file exists.

Populate `writtenAt` with an ISO-8601 UTC timestamp and `HEAD` with the output of `git rev-parse HEAD`. Replace the whole target file and retain the header phrase `supersedes previous`; amendments replace rather than accumulate. If a required anchor command fails, STOP without writing a handoff.

## 5. Emit exactly one pickup line

Choose the door from the produced artifacts and make it the final output line:

- Pure typed context with no residue: `do arc <ID>` or `do phase <N>`.
- Typed context plus a fence or other justified residue: `Read .building/HANDOFF.md (the fence), then do phase <N>`.
- No phase exists: `Read .building/HANDOFF.md and continue from Next.`

For a named handoff, replace `.building/HANDOFF.md` in the applicable line with `.building/handoff-<slug>.md`. Do not add commentary after the pickup line; the literal downstream contract enforces this at review time (honor-system).

## 6. Check completion

Re-run `git status --short`. Completion requires either (a) durable roadmap edits plus the pure pickup line, or (b) a handoff matching `references/template.md` plus the hybrid or pre-phase pickup line. Report any routed file edits before the final line.

Before trusting a handoff whose recorded HEAD differs from `git rev-parse HEAD`, run the exact staleness check in `references/template.md`. Trust the repository over the handoff when they diverge.
