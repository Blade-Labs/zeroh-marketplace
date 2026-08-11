# Test-worthiness

The one standard for assigning a task's `testMode` — and for refusing tests that do not
earn their keep. A test's job is catching a real regression; a test that cannot fail on
a behavior change is maintenance debt wearing a green badge.

## The three modes

| Mode | Earns its keep for | Because |
| --- | --- | --- |
| `tdd` | pure logic, contracts, business rules, error paths | behavior is assertable without a rendered surface, and the RED proves the test can fail |
| `e2e` | user-visible flows crossing a real boundary (browser, host, wire) | only driving the real seam proves the flow; a faked boundary tests the fake |
| `none` | everything else | the steps' own `→ verify:` commands are the check |

Default `none` when unsure — an unnecessary TDD loop costs more than it catches.

## The NEVER classes — no bespoke spec, whatever the mode

- **Declarative artifacts** — config, CI/deployment files, hosting descriptors, data
  files, docs. A spec asserting on YAML or JSON text re-states the file with extra steps.
- **UI presentation** — markup shape, class lists, rendered text of a component. Looks
  are judged by parity/vision gates, not string assertions.
- **Process guards** — "did the convention hold" checks outside a ratified lane.

A guard that genuinely seems needed is a case for an EXISTING lane — a ratchet, a lint
rule, an emit/sync check — or an architect call deciding which lane owns it. It is never
a spec minted beside the diff.

## The deviation protocol

A spec where the rule says none, or a skipped `tdd` where the rule says `tdd`, needs a
`software-architect` **Decision Contract** call — one hop, verdict recorded in the phase
notes. No recorded verdict = the deviation is unplanned and review refuses it. The
architect is invoked ON deviation, never per task.

## Examples (from a real inventory)

| Candidate | Ruling |
| --- | --- |
| a spec asserting a deploy workflow's YAML steps | NEVER — declarative artifact |
| a markdown parser's semantics | `tdd` — pure logic with real error paths |
| a spec on a component's rendered class names | NEVER — UI presentation |
| a route-coverage guard tied to the build's own route table | existing lane — the build guard owns it |
