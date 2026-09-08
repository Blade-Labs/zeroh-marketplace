# Does this check earn its cost?

Name the plausible regression a check would catch. Pure logic, contracts and error paths often benefit from test-first work. Real user flows need checks across the relevant boundary. A declarative edit usually needs its existing parser/linter or a focused inspection, not a new test copying its contents.

Do not make test-first a ceremony for every task or ban useful tests based only on a file extension. Test runtime semantics and invariants, not literal implementation text. Choose the consumer's runner and existing test seams; use its documented coverage requirements. A brief reason is enough for proportional verification; no architect approval is required to decide that a trivial docs edit does not need a new unit test.

See `skills/test-strategy/SKILL.md` for checking repeated state, integration behavior and expensive suites.
