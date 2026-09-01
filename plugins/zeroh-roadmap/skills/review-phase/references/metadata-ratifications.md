# Metadata Ratifications - the declarations Mode A is the gate for

Used by review-phase Mode A Step V. Nothing downstream re-checks these; this review is the
ratification the gate trusts. A "specialist path" = a `gateSpecialists` path in
`roadmap.config.json`. Record each ratification IN the phase artifact (`notes`) as well as the
report - the artifact is what downstream reads.

- **`testScope`**: a specialist / cross-module `src/` path is incompatible with
  `static`/`scoped`; declared `scopedTests` globs must resolve. Else NEEDS WORK.
- **Test shape**: each task's `testMode` ratified against
  `skills/using-zeroh-roadmap/references/test-worthiness.md` - a NEVER-class spec, skipped tdd
  on pure logic, a new bespoke test for a declarative artifact (its guard is the ratchet/lint
  lane), or a byte-for-byte data-file assertion, absent a recorded architect verdict = NEEDS WORK.
- **Licensing**: an external dep/asset names license + placement tier per
  `skills/using-zeroh-roadmap/references/external-assets-licensing.md`; missing, banned-tier, or
  server-side-only license in a shipped client artifact = NEEDS WORK.
- **`reviewScope`** below `full`: no `keyFiles`/`files[]` path may be a specialist path, and no
  `keyFiles` path may resolve into a foreign product repository (the gate mechanically floors that
  declared keyFiles case to `full`); the
  rung must fit the diff (`none` = docs/data only; `light` = small/mechanical, never a new
  governed surface/contract/ledger kind/subtle logic); the planner stated WHY. Unjustified low
  rung = NEEDS WORK.
- **`userFacing: true`** requires `flag: { id }` (runtime kill-switch) or a justified
  `{ bootWired, justification }`; flag posture follows consumer CLAUDE.md §Flag-first delivery
  (default ON; a deliberate OFF needs a named hold). Missing/violating = NEEDS WORK.
