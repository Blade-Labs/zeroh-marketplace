# zeroh-greenfield

Approval-gated setup for new repositories and gap-only standards work for
existing ones.

## Skills

- `using-zeroh-greenfield` chooses the correct workflow.
- `greenfield-init` interviews, proposes, waits for approval, and initializes.
- `brownfield-audit` identifies and fills approved gaps without replacing homes.
- `stack-decision` records sourced stack alternatives and the chosen option.

## Claude Code

```text
/plugin marketplace add Blade-Labs/zeroh-marketplace
/plugin install zeroh-greenfield@zeroh-marketplace
```

Restart Claude Code or begin a fresh session after installation so the skills are loaded.

## Codex

```text
codex plugin marketplace add Blade-Labs/zeroh-marketplace
```

Install or enable `zeroh-greenfield` from the Codex plugin marketplace, then start a fresh Codex session.

## How it relates

| Plugin | Ownership |
| --- | --- |
| zeroh-greenfield | Missing project homes |
| zeroh-roadmap | Consume pointers and run phases |
| zeroh-design | Blade tokens and themes |

The architecture and ownership decisions live in
[`roadmap/arc-prompts/GREENFIELD-execution-prompt.md`](../../roadmap/arc-prompts/GREENFIELD-execution-prompt.md).
