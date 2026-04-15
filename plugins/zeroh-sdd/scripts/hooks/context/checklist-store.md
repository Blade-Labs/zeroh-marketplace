You are writing a **state store** (Zustand, Redux, etc). Checklist:

- [ ] **safeParse on external data** — validate API responses before setting state
- [ ] **No direct mutation of validated state** — parse first, then set
- [ ] **Import types from shapes** — don't redeclare interfaces that exist as Zod schemas
- [ ] **Error state handling** — store should surface parse errors, not swallow them
