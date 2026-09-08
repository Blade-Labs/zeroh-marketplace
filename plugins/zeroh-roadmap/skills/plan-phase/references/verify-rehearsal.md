# Verification during planning and execution

A check must distinguish the claim it tests. Planning establishes a credible verification
strategy; execution supplies product red/green evidence. Neither phase may invent results.

1. **Current assumptions:** run cheap load-bearing probes now. A false assumption changes the
   plan. Name what would falsify each claim; a vacuous check must be replaced.
2. **Changed behavior:** name the test/command and expected outcome. Check the runner and paths;
   a new file must be declared in the creating task. If its implementation or tests do not exist,
   record “execution pending”; do not build scratch product code or count a missing-file error as
   a successful behavioral red. TDD execution writes the test, observes failure for the intended
   reason, implements, then observes green. No product suites/builds during plan review.
3. **Existing checks and retained behavior:** a passing regression or CI prerequisite is valid
   evidence of what already works, not proof of new behavior. Label it retained; do not invent a
   change merely to make it red. The changed behavior still needs its own discriminating check.
4. **Cheap removal/polarity checks:** exercise negative greps and uncertain command shapes against
   small scratch text copies. Anchor on removed text, check that replacement text does not also
   match, and pair absence with a positive replacement check. Do not mutate the shared tree.
   One representative per equivalent runner/flag family suffices; record inheritance explicitly.
5. **Observables:** name a concrete surface and expected value. “Works correctly” is insufficient.

Reuse executed probes while their inputs are unchanged; refresh affected evidence after edits.
Review judges coverage, failure meaning and feasible execution independently; it does not repeat
product suites. Unknown/unrun evidence remains pending, never green. Actual test and acceptance
results remain required during do-phase and validate-arc.

Common pitfalls: a bare `grep -c` exits1 for zero matches; a pipeline can hide the tested command's
exit; TypeScript needs the consumer's loader; self-colliding removal patterns can fail on success.
Use the existing test runner rather than embedding nested shell programs in step descriptions.
