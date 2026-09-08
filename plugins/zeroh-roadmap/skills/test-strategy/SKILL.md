---
name: "Test Strategy"
description: "Select proportionate checks that catch real regressions using the project test conventions."
user-invocable: true
---

# Test Strategy

Read the consumer's test strategy, package scripts and nearby tests. Existing `testConventions` JSON pointers remain useful guidance; missing pointers do not require configuration negotiation. Infer conventions from actual code and say what remains uncertain.

Use unit checks for pure rules and error boundaries; integration checks for real wiring; end-to-end checks for actual user journeys. Put assertions at the cheapest level that honestly observes the behavior. Test reruns, populated state and failures when they can differ from a clean first run. Prefer a regression test that fails without the repair.

Do not test copied source text, class lists or a manifest's exact bytes simply to claim coverage. Existing parsers/validators can check declarative invariants; visual checks can judge presentation. Runtime loaders and schema behavior still deserve meaningful behavioral checks. Use project coverage requirements rather than inventing universal percentage gates.

Use existing scoped runner options when their semantics are known. Respect the host's actual shared-resource admission for heavy tests; never turn a local concurrency guess into a plugin-wide scheduler. Observe exit codes, distinguish interruption from test failure, diagnose before rerunning, and do not rerun a full expensive suite after a small repair when focused checks plus required CI cover it.

Never weaken assertions to accommodate a regression. Mock at real external seams, verify relevant arguments and boundaries, and drive required shipped integrations independently of mocks.
