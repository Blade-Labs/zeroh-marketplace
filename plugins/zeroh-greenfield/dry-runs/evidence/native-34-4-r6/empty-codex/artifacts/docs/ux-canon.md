# UX canon

## Visual language

Plain text CLI. Non-Blade. No visual tokens, fonts, palette, spacing system, or component registry; these do not apply to a reusable library and terminal command.

## Component vocabulary

One optional name argument, one --help option, stdout, stderr, and process exit status.

## Interaction rules

With no argument, print Hello, world! followed by a newline and exit 0. With one nonblank name, print Hello, <name>! followed by a newline and exit 0. Preserve nonblank names verbatim; quote names containing spaces in the shell.

With exactly --help, print the following text followed by a newline to stdout and exit 0:

    Usage: greenfield-proof [name]
           greenfield-proof --help

Unknown options, including -prefixed arguments, or more than one argument print that usage to stderr and exit 1 without stdout. Blank names print Name must not be blank followed by usage to stderr and exit 1. There are no color codes, prompts, external calls, or interactive states.

## Binding design system

None. [ADR 0002](adr/0002-design-system.md) records the non-UI choice and absent-registry reason. No token home is invented. Future localization and visual requirements are unknown.
