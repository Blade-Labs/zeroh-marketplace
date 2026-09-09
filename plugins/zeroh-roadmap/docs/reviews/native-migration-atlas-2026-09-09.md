# Atlas arc migration observation — 2026-09-09

Ported a read-only copy of Atlas's **UIPOLISH** arc and phases **73–76** using the candidate `roadmap migrate` command. The fixture was `/tmp/roadmap-atlas-migration`; Atlas itself was not edited. No Atlas source, transcripts or generated consumer records are committed in this PR.

The first preview reported three missing native fields: intent, scope and status. The operator supplied a three-field decisions file from the existing source header and execution prompt, keeping backlog status (all four phases were backlog), the same phase membership, original constraints and all original acceptance promises. This was a format migration of an already planned arc, not new scope approval. No task-by-task rewrite was needed.

The final preview/apply converted one arc and four phases, retaining **19 tasks** and **three criteria**. Each criterion's job, signal and bar was retained in its description. All five declarative records were preserved under `extensions.roadmapMigration.original`, with immutable Git `sourceRef` pointers preserving the exact original source files; comparison with the fixture's original Git commit and the still-unchanged Atlas source passed. Current progress lives in the new typed fields, not that historical snapshot. The old schema was retained, and the command generated a native schema plus a small routing facade.

Observed results:

- Isolated TypeScript check: exit 0, no diagnostics. It included the copied old schema and actual Atlas registry/emitter as well as the new records and schemas; it was not Atlas's full product build.
- `roadmap phase validate --all --json`: all five records valid.
- `roadmap status --json`: exit 0 and the migrated records visible.
- The copied legacy emitter returned **exit 0 with arc and cross-validation warnings**: it could not recognize the new arc shape. This is not a passing compatibility check. The migration report identifies `lib/roadmap/emit.ts` and `lib/roadmap/registry.ts` as legacy-schema callers. Native JSON status works; any old Markdown/output contract still needs explicit replacement or adaptation in the consumer.

Automated synthetic regressions separately cover preview/no writes, missing decisions, repeated application, original metadata/Git-source preservation, a completed phase remaining unchanged and validating with its old schema, retired caller discovery, computed source refusal, schema collision, ambiguous task state and refusal to execute a migrated arc without its approved-intent reference. The actual Atlas trial uses planned work, not completed phases or a running arc.

Limits: this is one arc's format/type/validation migration, **not** whole-Atlas migration, product acceptance, unattended continuation, a native worker run or approval to update Atlas's plugin cache. The four already planned phases were preserved; the migration does not discard existing plans to force a two-phase rolling window. Before execution, establish the reviewed literal intent baseline and adapt remaining consumer callers. Root-local schema collisions and computed legacy records remain explicitly unsupported automatic cases.
