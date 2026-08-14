# Skill Authoring Standard (SKILL.md Quality Bar) v2

Each rule is tagged with its evidence source: [TEXT] = checkable from the skill's
text alone; [REPO] = requires cross-checking the repo, sibling skills, or CLI help.
A reviewer marks every rule PASS / FAIL / N-A. Scoring is at the end.

## Content delta

**R1. Delta-only paragraphs.** [TEXT] FAIL if any paragraph contains no
project-specific path, command, contract name, threshold, vocabulary term, or
ratified decision, i.e. it would read as correct advice pasted into an unrelated
project unchanged.

**R2. Every section carries a specific.** [TEXT] Every H2 section contains at
least one literal command, file path, contract/schema name, numeric threshold,
or dated ruling. FAIL for any section of pure prose guidance.

## Frontmatter and activation

**R3. Description = capability + triggers.** [TEXT] First sentence names the key
use case; the description lists concrete trigger phrasings or task shapes, and is
500 characters or fewer. FAIL if it restates the name, omits triggers, or exceeds
the cap.

**R4. Sibling disambiguation is written down.** [REPO] If another skill in the
plugin covers an overlapping domain, this skill's description or body contains a
"Not this skill:" line naming that sibling and the boundary. FAIL if the overlap
exists and neither skill names it.

**R5. Dangerous workflows are manual-only.** [TEXT] Any skill whose steps include
deploys, releases, prod mutations, destructive git or filesystem operations, or
paid API spend sets `disable-model-invocation: true`, or states in one line why
not. FAIL otherwise.

**R6. Frontmatter is minimal and valid.** [TEXT] Only runtime-recognized keys
(unknown keys go under `metadata`); `allowed-tools` lists only tools some body
step actually invokes. FAIL on unknown top-level keys or unused grants.

## Size and progressive disclosure

**R7. Hard line caps.** [TEXT] Body is at most 100 lines for a reference skill,
200 for a multi-stage workflow. Over the cap = FAIL, no exceptions: move content
into `references/` (R8) or delete it (R1).

**R8. References cited at point of use.** [REPO] Branch-specific material
(rubrics, schemas, long checklists) lives in `references/*.md`; the body cites
each file by path at the step that needs it. FAIL if the body inlines a
single-branch lookup table, or a `references/` file exists that no body line cites.

**R9. Deterministic procedures are code.** [REPO] If a step's output is fully
determined by its inputs (no judgment), the skill invokes a committed script or
CLI subcommand. FAIL if the body asks the model to hand-simulate an algorithm a
script in the repo already implements.

## Structure and voice

**R10. Imperative and front-loaded.** [TEXT] Instructions are second-person
commands. Rationale is at most one clause attached to its rule. FAIL on any
paragraph containing zero imperative sentences.

**R11. Heading order = execution order** (workflow skills only). [TEXT] FAIL if
the run sequence cannot be reconstructed from heading order alone.

**R12. Commands are copy-pasteable.** [TEXT] Every command, path, event name, and
commit format is literal; variable parts use `<angle-bracket>` placeholders that
the surrounding text defines. FAIL on any step whose invocation must be guessed.

**R13. Failure exits are named** (workflow skills only). [TEXT] Each failure mode
states its trigger condition and the action (STOP, escalate to whom, or fallback).
FAIL if only the happy path is described. N-A for reference skills.

**R14. Gotchas are symptom + response pairs.** [TEXT] Each warning states the
observable signal and the correct reaction. FAIL on "be careful with X" alone.

## Duplication and boundaries

**R15. One owner per fact.** [REPO] A contract, vocabulary list, or procedure
appears in exactly one SKILL.md or one shared `references/` file; siblings cite
it by path. FAIL if the same rule text appears in two bodies.

**R16. No CLAUDE.md restatement.** [REPO] The skill cites CLAUDE.md rules it
depends on; it never paraphrases them. FAIL on restated CLAUDE.md content.

**R17. Boundaries declared both ways.** [REPO] Each of two overlapping skills
states which one owns the boundary case. FAIL if a reviewer reading both cannot
assign a boundary case to exactly one.

## Existence and retirement

**R18. Merge trivial skills.** [TEXT] A skill with a body under 15 lines is kept
only if it needs independent activation (its own trigger routing) or
`disable-model-invocation`; otherwise FAIL: fold it into CLAUDE.md or a sibling's
`references/`.

**R19. Retire superseded skills.** [REPO] FAIL if the skill contradicts a newer
skill, committed script, or CLAUDE.md rule anywhere; delete it or reduce it to a
pointer in the same change that lands the contradiction.

**R20. Evidence of use is recorded.** [TEXT] The skill cites at least one real
run (commit hash, dated provenance line, or produced artifact path), or its
frontmatter carries `metadata.experimental` with a review-by date. FAIL if
neither is present.

## Verifiability and output contracts

**R21. Cited paths and commands resolve.** [REPO] Every literal file path exists;
every CLI subcommand appears in the tool's help or source. FAIL on any dead
reference.

**R22. Tuned numbers carry provenance.** [TEXT] Any threshold states its source
or rationale in one clause ("raised from 70% after phase 2041"). FAIL on bare
magic numbers.

**R23. Done is an artifact** (workflow skills only). [TEXT] Completion is defined
as an exit code, a produced file, or a verdict enum. FAIL if success is a quality
adjective. N-A for reference skills.

**R24. Downstream output is a literal contract.** [TEXT] Where output feeds
another tool or agent, the skill includes the template or schema verbatim, such
that a parser could be written from the skill text alone. N-A when nothing
consumes the output.

## Maintainability

**R25. Stable anchors only.** [TEXT] Reference paths, command names, and exported
symbols; never `file.ts:123` line anchors or quoted volatile prose.

**R26. No relative time.** [TEXT] Dates appear only as provenance on decisions.
FAIL on temporal phrasing that rots: "recently", "currently", "now", "soon",
"the new X", "we just changed".

**R27. Amendments replace, never append.** [TEXT] FAIL if the current rule can
only be derived by reading contradictory strata ("UPDATE:", "NOTE: this changed")
top to bottom.

**R28. Hard constraints name their enforcement** (MUST/NEVER rules only). [TEXT]
Each states what blocks violation (hook, CLI refusal, parse failure) or is marked
`honor-system`. FAIL if a reviewer cannot tell which. Do not tag ordinary guidance.

## Scoring

- Blockers (any FAIL blocks the skill outright): R1, R5, R19, R21.
- All other FAILs: three or more block until fixed; fewer must be fixed in the
  next edit that touches the skill.
- Re-review trigger: any diff that touches a path, command, or schema the skill
  cites (detectable by grepping the diff for the skill's cited literals), or any
  change to a sibling named in its "Not this skill:" line.
