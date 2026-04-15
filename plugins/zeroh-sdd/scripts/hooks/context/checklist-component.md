You are writing a **UI component**. Checklist:

- [ ] **Import types from shapes** — don't redeclare Props interfaces that exist as inferred Zod types
- [ ] **Error boundary** — component should handle render errors gracefully with actionable message
- [ ] **Use design skill if available** — for brand-consistent UI, invoke `frontend-design` skill
- [ ] **No hardcoded mock data** — use real data sources or explicit empty states ("no data"), never fake data that looks real
