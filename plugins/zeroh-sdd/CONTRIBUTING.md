# Contributing to zeroh-sdd

Run the runtime self-tests before changing the plugin:

```bash
npm test
```

Hook behavior belongs in `bin/zeroh-sdd.mjs`. Keep hook configuration thin and declarative in `hooks/hooks.json`.

Rules for changes:

- preserve the active-stage loop
- keep hard blocks limited to execution-boundary integrity
- emit AP findings as advisory envelopes with `_fix.prompt`
- add or update self-test coverage for any runtime behavior change
- update `README.md` when public commands, state files, hooks, or skills change
