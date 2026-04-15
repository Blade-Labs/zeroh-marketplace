You are writing a **route handler / API endpoint**. Checklist:

- [ ] **safeParse at boundary** — validate request/response with `validatedParse(Schema, data, { route })` or `Schema.safeParse(data)`
- [ ] **handleError in catch** — use canonical error utility, not `throw new Error(message)`
- [ ] **remediation string** — every error must include what to check, what to run, what is missing
- [ ] **X-Trace-Id propagation** — pass trace ID through to upstream calls and response headers
- [ ] **RFC 9457 response shape** — error responses should include: type, title, status, detail, remediation
- [ ] **No `response.json() as T`** — type assertions bypass validation. Use safeParse instead.
