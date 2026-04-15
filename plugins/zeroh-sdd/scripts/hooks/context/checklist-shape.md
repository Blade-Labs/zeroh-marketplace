You are writing a **Zod shape file**. Checklist:

- [ ] **`.describe()` on every field** — human-readable, LLM-consumable field documentation
- [ ] **`.meta()` with at minimum Operational tier** — name, version, category (placed LAST — lost if before .refine())
- [ ] **`.refine()` for cross-field rules** — temporal ordering, business formulas, conditional requirements (PQ7)
- [ ] **`z.discriminatedUnion()`** if entity has status/state field — per-state required fields
- [ ] **`.strict()` or `z.strictObject()`** if this is a parse boundary (validates external input)
- [ ] **`.brand<T>()`** for domain-critical IDs that must not be confused (ContractId vs CounterpartyId)
- [ ] **`acceptanceCriteria` in .meta()** — what must be true for data conforming to this shape
- [ ] **Use `deriveIdentity(filePath, exportName)`** for auto-generating id and prefLabel from conventions
