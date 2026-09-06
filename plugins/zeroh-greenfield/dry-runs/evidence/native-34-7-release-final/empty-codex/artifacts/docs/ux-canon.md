# UX canon

## Visual language

Plain terminal text. Fonts, palette, spacing and visual tokens are inapplicable.

## Component vocabulary

An imported greet(name?: string) function and greenfield-proof CLI. No graphical components or registry.

## Interaction rules

greet() and greet(undefined) return Hello, world!. A supplied nonblank string returns Hello, <name>! with its characters preserved. Empty or whitespace-only names throw TypeError; nonstring JavaScript inputs also throw TypeError.

The CLI accepts zero or one name, prints the greeting plus a newline to stdout and exits 0. The sole --help argument prints usage to stdout and exits 0. Unknown options, extra arguments and blank names print an error and usage to stderr, print no greeting, and exit 1.

    Usage: greenfield-proof [name]
           greenfield-proof --help

## Binding design system

None, per [ADR 0002](adr/0002-design-system.md). Non-Blade; registry absent/none because there is no UI. A new approved requirement is necessary before introducing visual tokens.
