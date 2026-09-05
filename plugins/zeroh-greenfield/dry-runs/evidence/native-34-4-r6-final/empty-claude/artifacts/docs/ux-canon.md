# UX canon

## Visual language

None. greenfield-proof has no graphical surface; its only user-facing output is plain UTF-8 text on stdout and stderr. No fonts, palette, or spacing values exist and none are invented.

## Component vocabulary

- Greeting line: `Hello, <name>!` followed by a newline on stdout.
- Usage text: starts with `Usage: greenfield-proof [name] [--help]` and lists the options.
- Error line: one human-readable sentence followed by the usage text on stderr.

## Interaction rules

- `greenfield-proof` with no argument prints the default greeting and exits 0.
- `greenfield-proof <name>` prints the greeting for that name and exits 0.
- `--help` or `-h` prints the usage text on stdout and exits 0.
- An unknown option, more than one positional argument, or a blank name prints an error line plus the usage text on stderr and exits 1.
- An unknown option always exits 1, even when `--help` or `-h` is also present in any position; help never masks an invalid invocation.
- Output is deterministic and never colored, interactive, or dependent on the terminal.

## Binding design system

None. Non-Blade with no UI surface; `designHomes.ux.bindingDesignSystem` is intentionally unset (ADR 0002).
