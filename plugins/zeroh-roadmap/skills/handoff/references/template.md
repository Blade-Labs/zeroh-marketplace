# Handoff residue template

Preserve this structure exactly when writing `.building/HANDOFF.md` or `.building/handoff-<slug>.md`. Remove placeholder bullets that have no value; keep every heading.

```markdown
# Handoff — <mission> · writtenAt <ISO-8601-UTC> · HEAD <sha> · supersedes previous

## Invocation

<exactly one pickup line>

## Fence

- <scope constraint or cross-phase intent>
  Why not routable: <reason>

## State

- SHA: <sha and meaning>
  Why not routable: <reason>
- Background task: <command or task identifier and state>
  Why not routable: <reason>
- Artifact URL: <URL and meaning>
  Why not routable: <reason>

## Unclear

- <open item> — awaiting <person or role>
  Why not routable: <reason>

## Residue

- <ephemeral gotcha>
  Why not routable: <reason>

## Next

- <next action, only when no phase exists>
  Why not routable: no phase exists yet

## Siblings

- `.building/handoff-<slug>.md` — <parallel session>
```

On pickup, substitute the header's recorded `<sha>` and run this exact command without flags or aliases:

```bash
git log --oneline <sha>..HEAD
```

If the command prints commits, trust the repository over the handoff and reconcile the file before acting on its state.
