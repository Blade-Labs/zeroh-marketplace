You are writing a **test file**. Checklist:

- [ ] **`@covers` or `@spec` annotation** — trace each test to the acceptance criterion it verifies
- [ ] **BLOCK + ALLOW scenarios** — test both the rejection case AND the happy path for each rule
- [ ] **TED metadata** if using gate.assert() — gateId, severity, owner, rule, rationale, remediation (6 fields)
- [ ] **Derived from acceptance criteria** — tests should come FROM the spec, not be invented to pass
- [ ] **No `.skip()` or `xit()`** — skipped tests are hidden failures. Fix or delete, don't skip.
- [ ] **Co-located with implementation** — test file lives alongside the code it tests, not in a separate tree
