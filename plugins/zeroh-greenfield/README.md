# zeroh-greenfield

Start from an idea and reach a runnable first prototype with a good foundation.
Greenfield interviews only unresolved product/platform choices, selects an
appropriate template, and proposes architecture, stack rationale, test strategy,
project structure and local run instructions. CI/release infrastructure is optional.

For an existing project, inspect the actual architecture and tests, then offer
missing or stale practices as individual improvements. Accept all, a subset, or
none; existing working homes and code are preserved. Changes require approval.
Large executable programs are prepared once and checked before execution with
`scripts/prepared-program.mjs`; hashes are computed
from actual bytes, not predicted by the model.

Install the paired `zeroh-roadmap` 0.40.0 or a later compatible release before setup.
The preflight requires `roadmap config capabilities --json`; older installed Roadmap
snapshots must be updated before Greenfield can write to a consumer.

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
