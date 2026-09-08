# Small project setup example

Use `templates/small-project.json` at the installed plugin root for a fully specified Node ESM
CLI with no runtime dependencies and a real `npm test` script. Its config, arc and phase are
checked against the shipped schemas by `cli/commands/init.test.mjs`. It is reference material,
not a live phase copied by init. Adapt the outcome to the user's brief; do not impose this CLI
or stack on other projects. Greenfield still owns interviews and stack/template choice.

1. Inspect repository instructions, package scripts, Git state and the supplied brief. Run
   `roadmap init` once if no roadmap exists; preserve an existing config. The example's `config`
   shows only the applicable settings: real unit tests, `none` for genuinely inapplicable slots,
   and the scaffold's emit command. Retain applicable existing gates; never replace them with
   `none` just because this example does. Dependencies use the consumer's chosen lockfile.
2. The delivery example assumes an already authorized, verified origin, main base, exact feature
   branch and CI check named `test`. Substitute actual values. Config expresses policy, not
   permission to publish; no merge is granted. Do not copy delivery settings for local-only work.
3. Reuse the reserved phase number supplied by plan-arc; otherwise use `roadmap claim` once.
   Adapt `phase` into
   `<root>/phases/phase-N.phase.ts` with `import { definePhase } from '../lib/schema'` and
   `export default definePhase({...})`. Replace number/task IDs, actual model identity (unknown
   stays unknown), files and outcome; the example is not an authored plan or review result.
4. For requested PR delivery, adapt `arc` into `<root>/arcs/<ID>.arc.ts` using the same relative
   import of `defineArc`. Keep IDs, phase.arcId, arc.phases, base and delivery strategy consistent.
   The flat `phases` input normalizes to one plane. Record existing interview/design rulings and
   the compact promise-to-task mapping in the arc, with the brief referenced once in the execution
   prompt. Follow plan-arc's single-phase delivery branch; unresolved design still needs its gate.
5. Run `roadmap config check` and `roadmap phase validate N`, then independent plan review.
   On Codex: `roadmap codex review N --parent-authority <actual-parent-profile>`; optional
   `--doc <repository-relative-path>` only when a document is supplied. For cold checkouts,
   follow the returned preparation recipe within current authority and retry the same command.
   The supervisor queues only READY. Continue using do-phase/do-arc, their correctness review,
   real tests, sweep, intent validation and authorized delivery. No handcrafted driver or hashes.

Do not treat tests that do not yet exist as passing. The example intentionally contains no
product implementation, CI credentials, review approval, execution result or delivery receipt.
