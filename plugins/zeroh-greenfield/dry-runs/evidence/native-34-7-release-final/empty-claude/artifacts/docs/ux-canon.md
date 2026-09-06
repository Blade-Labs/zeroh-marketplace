# UX canon

## Visual language

None. The product has no graphical surface; the only user interface is plain CLI text on stdout and stderr, with no colours, tokens, fonts, palette or spacing.

## Component vocabulary

- Greeting line: `Hello, <name>!` followed by a newline on stdout.
- Usage text: starts with `Usage: greenfield-proof [name]` and lists the options.
- Error line: one sentence on stderr, followed by the usage text.

## Interaction rules

| Invocation | stdout | stderr | exit |
| --- | --- | --- | --- |
| `greenfield-proof` | `Hello, world!` | empty | 0 |
| `greenfield-proof Ada` | `Hello, Ada!` | empty | 0 |
| `greenfield-proof --help` or `-h` | usage text | empty | 0 |
| `greenfield-proof --unknown` | empty | `Unknown option: --unknown` + usage | 1 |
| `greenfield-proof --help --unknown` (any order) | empty | `Unknown option: --unknown` + usage | 1 |
| `greenfield-proof ''` or a whitespace-only name | empty | the `TypeError` message + usage | 1 |
| more than one name | empty | `Too many arguments` + usage | 1 |

Unknown options are checked before help, so an unknown option never exits 0. The API mirrors the CLI: `greet()` and `greet(undefined)` return `Hello, world!`, `greet(name)` returns `Hello, <name>!` verbatim, and blank names throw `TypeError`.

## Binding design system

none — ADR 0002 records the non-UI ruling; `designHomes.ux.bindingDesignSystem` is absent and no tokens are defined.
