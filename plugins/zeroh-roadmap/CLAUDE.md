# Roadmap operator guidance

Use `skills/using-zeroh-roadmap/SKILL.md` for routing and `MULTI-DRIVER.md` for native dispatch. The supervising session owns execution. Read the actual consumer schema and project instructions before editing typed records.

Supported commands: `status`, `claim`, `init`, `phase validate <path>` (phase or arc). Run strict validation before queueing and completion. The supported hook is fail-soft validation diagnostics; it does not replace explicit validation and is not proof of Codex automatic enforcement.

No workflow module, custom driver, gate runner, phase watchdog, curation or scoring stage remains in the active path. Use native agent/shell/Git tools with existing project checks and host resource admission. Keep independent reviewers separate from the author; when a worker cannot spawn, the supervisor arranges the helper.

## Consumer upgrade boundary

Inventory old command callers before upgrading a consumer. Consumers depending on removed automation stay on the compatible release until explicitly adapted. Do not rewrite their scripts, configuration, history or vendored schema merely because the plugin cache changed.

Read legacy JSON pointers and explicit policy directly as guidance. Unknown or malformed policy never grants additional authority. New records use the small typed contract; existing strict vendored schemas govern their own writes until a focused opt-in upgrade. Establish a legitimate approved-intent Git reference for active legacy arcs, not a baseline reverse-engineered from current results.

Work ownership is separate from permanent phase-number allocation. Acquire an exclusive claim with a stable owner; resume only with that same owner. Foreign/stale ownership remains held until explicit checked handoff/release, never by timeout or PID inference.

Historical Gauntlet and optimization documents describe earlier implementations. They are evidence for review, not current execution instructions. Do not revive obsolete mechanisms because an old trial names them.
