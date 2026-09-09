# ZeroH Roadmap

Skills and typed progress for getting from intent to accepted software with native Claude or Codex agents. Agree the outcome and boundaries, plan the next useful window, implement with meaningful checks, and independently review the result. Fix gaps within scope without repeatedly asking for the same permission.

## The loop

1. **Plan intent:** record observable acceptance, assumptions, non-goals and canonical design/PRD references. Reuse existing decisions and ask only consequential unknowns.
2. **Plan the next window:** detail one or two phases; keep later criteria explicitly deferred. A phase delivers an independently testable user journey.
3. **Execute natively:** the supervising session dispatches a phase worker and independent reviewers using the host's actual tools. It owns scope, queue and Git operations.
4. **Observe and replan:** use results to detail the next window within agreed scope and budget. Empty queued work does not finish an arc with deferred outcomes.
5. **Judge intent:** an independent reviewer reads the committed original criteria and legitimate owner ratifications, then drives the delivered behavior. Repair real gaps before claiming completion.

One clean review is enough. Three rounds is a ceiling, not a target. No mandatory quality-pass chain, scorecard, proof collection or detached workflow engine is required.

## Start

Install the plugin through your host's supported marketplace flow, then ask to plan a phase or arc. Invoke the installed `roadmap` executable (or `node <actual-plugin-root>/bin/roadmap.mjs`).

```sh
roadmap init
roadmap status
roadmap claim --count 2
roadmap claim --work EXAMPLE --owner session-owner
roadmap phase validate roadmap/arcs/EXAMPLE.arc.ts
roadmap claim --work EXAMPLE --owner session-owner --release
```

Use the discovered root, which may be `docs/roadmap/` or an explicit `ROADMAP_ROOT`, rather than copying the example path. Init creates typed scaffolding without overwriting existing consumer files; follow its dependency instructions. Typed records require `tsx` and `zod` in the consumer or installed plugin dependency setup. Active intent validation also needs the `typescript` parser, supplied by the Roadmap package dependencies or the consumer's dependencies. Install missing dependencies with the appropriate package manager and lockfile; missing tooling is unavailable, never a green check.

The CLI has four responsibilities: factual status, permanent number reservations and explicit exclusive work claims, non-overwriting init, and strict phase/arc validation. Native sessions own tests, agents, review, replanning and Git. Work claims coordinate sessions in the same Git repository; they are not distributed locks and never expire automatically.

## Greenfield

For a new project, Greenfield offers a short PRD interview and selected web/mobile/desktop/combined or library/CLI recipe. It helps establish a runnable foundation before Roadmap plans the next outcome. For an existing project, offer missing architecture/test/run guidance selectively; declining those improvements does not block Roadmap. Greenfield is optional and usable independently.

## Compatibility

Existing consumer files and vendored schemas stay owned by their projects. Strict legacy schemas still govern their writes until an explicit focused upgrade; historical records remain readable. Active arcs must establish an actual approved-intent baseline before proceeding. A legacy schema that rejects or strips `intentRef` needs a focused, reviewed opt-in metadata/schema upgrade before continuation; adding the property to an arc alone cannot fix that. Preserve its historical records and acceptance meaning, or stay on the compatible plugin release until the upgrade is ready. Approved baseline source must contain a literal declarative arc object: imported helper values, computed acceptance and spreads are unsupported rather than evaluated against mutable working-tree code. Existing JSON design/test/validation/merge policy remains guidance, not a gate-engine configuration.

Automation using retired commands must remain on a compatible release until explicitly adapted. A plugin/cache update does not migrate consumers, overwrite schemas or grant authority. See [CLAUDE.md](CLAUDE.md) for the migration boundary and [MULTI-DRIVER.md](MULTI-DRIVER.md) for native execution.

These instructions and validators enforce recorded consistency, not truthfulness or product quality by themselves. Real checks and independent judgment remain necessary. Host support and performance claims require observed native runs.

## Updating the plugin version

From `plugins/zeroh-roadmap`, run `npm version <new-version> --no-git-tag-version`. npm updates the single source in `package.json` and its lockfile, then the version lifecycle automatically runs the existing manifest generator. All five host manifests and the generated install guide receive that value. Review and commit those generated changes together; tagging and publishing remain separate.

Do not hand-edit manifest versions. If you edited `package.json` directly, run `npm install --package-lock-only --ignore-scripts` and `npm run version` to synchronize the lockfile and generated files. CI already runs `node scripts/emit-manifests.mjs --check` to reject manifest drift. Historical changelog entries and recorded evidence retain their original versions.

See the [documentation index](docs/README.md) for current guidance and historical reviews.
