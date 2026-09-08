# Consumer layout and compatibility

Discover the roadmap root (`roadmap/` or `docs/roadmap/`); `ROADMAP_ROOT` explicitly overrides it. Both marked roots are ambiguous and must be resolved explicitly. Use `roadmap status` and its reported root rather than assuming a path.

`roadmap init [--root <dir>]` scaffolds the retained typed templates without overwriting consumer files. It does not choose architecture, install a gate engine or migrate existing records. Read the command's dependency instructions and validate the generated records after setup. Missing architecture/test guidance can be offered through Greenfield, but is optional.

Load the consumer's root-local schema, or its supported legacy schema location. Existing strict vendored schemas govern existing writes until a focused opt-in upgrade is reviewed; never overwrite them on a cache update. Historical archives remain readable. An active legacy arc needs a legitimate committed approved-intent baseline before continuing.

Read explicit legacy JSON policy (`designHomes`, `testConventions`, `validationTiers`, `mergePolicy`) directly as guidance. Unknown or malformed policy cannot grant authority. Missing optional homes are not permission to invent approval, nor an initialization blocker. Respect project-specific checks and permissions without invoking retired automation.

The supported CLI is `status`, `claim`, `init`, and `phase validate <path>` (phase or arc). Run strict validation before queueing and completion on both hosts. Post-write hooks are incomplete, host-dependent diagnostics; they are not automatic prevention on Codex. Old consumer automation calling retired commands must stay on its compatible plugin until explicitly adapted; a cache update must not silently migrate it.
