You are in the **GREEN** phase. The goal is to write implementation that makes RED tests pass.

**Allowed:** Implementation code, fixing failing tests by fixing the CODE (not the test)
**Not allowed:** Modifying test assertions, removing tests, skipping tests, weakening gates

**Red flags:**
- Changing `toThrow()` to `toBeUndefined()` → test capitulation
- Deleting a test stub to fix a lint error → scaffold integrity violation
- Adding `.skip` to a failing test → test capitulation
- "This is a pre-existing issue, not my problem" → in an LLM codebase, you ARE the prior session
