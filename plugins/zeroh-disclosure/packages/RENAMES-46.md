# Phase 46 split map

Compatibility entries keep the original public names and signatures. This map records where each implementation moved; unchanged helpers are grouped by concern where listing every private lexical primitive would obscure the seam.

## Shell analysis

- `shell-programs.js`
  - `readOptions` → `programs/options.js` (`programs/curl-wget.js` is the family facade)
  - `interpreterSpec`, `interpreterCode` → `programs/interpreters.js`
  - `readSedScript`, `sedProgram`, `readAwkProgram`, `awkProgram` → `programs/text-editors.js`
  - `gitCommand`, `commandAssignments`, `ghCommand` → `programs/git-gh.js`
  - `opensslCommand` → `programs/network.js` (`programs/cloud-clis.js` is the family facade)
  - `uncHost`, `localProgramReach`, `optionWrites`, `optionWritesInto` → `programs/archive-and-fs.js`
  - `readCode`, `execCommand` → `programs/code.js`
  - composition → `programs/index.js`; the seven required family entries are `curl-wget.js`, `git-gh.js`, `cloud-clis.js`, `dns.js`, `docker.js`, `archive-and-fs.js`, and `shells.js`
- `shell-scan.js`
  - shared lexical helpers → `tokenizer/shared.js`
  - Bash word and sequence parsing → `tokenizer/bash-core.js`, `tokenizer/bash-sequence.js`, `tokenizer/bash.js`
  - command launcher/inline-code parsing → `tokenizer/cmd.js`
  - PowerShell parsing → `tokenizer/powershell.js`
  - `analyzeBash`, `analyzeShell`, `shellReadings` → `scan.js`
- `settings-guard.js`
  - settings and user-only path guards → `guard/protected-paths.js`
  - explicit effect/write classification → `guard/explicit-writes.js`
  - `isReadOnlyInspection`, `protectedShellDecision` → `guard/plain-safe-reads.js`
  - ZeroH management command detection → `guard/management.js`
  - Claude control detection/decision → `guard/claude-control.js`
- `shell-destinations.js`
  - program and option tables, `tokenName` → `destinations/options.js`
  - `operandHost`, `shellDestinations`, host decisions → `destinations/hosts.js`
- `secrets.js`
  - credential/name/load detection → `secrets/detect.js`
  - `exactValueHits`, scrub and restore steps → `secrets/rewrite.js`
  - destination and sensitive-path decisions → `secrets/decide.js`
- `late-bind.js`
  - constants, paths and binding detection → `late-bind/detect.js`
  - `rewriteBashCommand` → `late-bind/rewrite-bash.js`
  - `rewritePowerShellCommand` → `late-bind/rewrite-powershell.js`
  - rewrite composition → `late-bind/rewrite.js`
  - preparation, cleanup, `deleteValuesFile`, `claudeCodeBraceQuoteRefusal` → `late-bind/decide.js`

The old registry had no DNS or Docker program-reader exports. Their family entries are intentionally empty; existing DNS/Docker classification remains in destination analysis rather than inventing behavior during a refactor.

## Disclosure core

- `vault.js`
  - errors, key material, encryption, persistence and file locks → `vault/store.js`
  - `Vault` and project/token scope methods → `vault/scope.js`
  - `checkVaults`, `resetVaults`, `vaultRetention`, pruning and backup lifecycle → `vault/lifecycle.js`
- `report.js`
  - registration, recording, collection, aggregation and storage → `report/collect.js`
  - turn/receipt/token summaries and report rendering → `report/render.js`
- `user-authority.js`
  - argument canonicalisation, tickets, ancestry, authority checks and `runAsUser` → `user-authority/authority.js`
  - `beginRemoval`, `finishRemoval`, removal lock/log/detached process → `user-authority/removal.js`
  - management-prompt recognition and remaining-step text → `user-authority/remaining-steps.js`
- `receipt.js`: `prepareDisclosure` steps → `analyzeDisclosure`, `signDisclosure`, `buildPublicClaims`, `buildSelectiveClaims` in the same component entry.
- `verify-receipt.js`: verification steps → `verifyReceiptIdentity`, `verifyReceiptTurn`, `verifyReceiptPolicyAndEngine`, `verifyReceiptContent` in the same component entry.

## Host adapter

- `hooks/pre-tool-use.js`
  - tool-input restoration → `lib/hook-steps/pre-tool-use/restore-tool-input.js`
  - destination/value/token/MCP descriptions → `lib/hook-steps/pre-tool-use/describe-tool-use.js`
  - exit-status wrapping → `lib/hook-steps/pre-tool-use/wrap-exit-status.js`
  - audit recording → `lib/hook-steps/pre-tool-use/record-tool-audit.js`
- `hooks/user-prompt-submit.js`
  - prompt enforcement, sent/unsaved values, mentioned files and token records → `lib/hook-steps/user-prompt-submit/process-prompt-values.js`
  - prompt notice collection → `lib/hook-steps/user-prompt-submit/collect-prompt-notices.js`
- `hooks/post-tool-use.js`
  - response text/image/channel inspection → `lib/hook-steps/post-tool-use/inspect-response.js`
  - output-source and token-observation description → `lib/hook-steps/post-tool-use/describe-output-source.js`
- `bin/zeroh-disclosure.mjs`
  - shared authority/output → `lib/cli/shared.js`
  - one module per subcommand → `lib/cli/{allow,banner,catalog,doctor,proxy,receipt,receipts,report,reports,statusline,tokens,uncertain,uninstall,unmask,vault,verify}.js`
  - legacy-project removal → `lib/cli/legacy-projects.js`
  - uninstall planning/execution/rendering/final state → `lib/cli/{uninstall-plan,uninstall-execute,uninstall-render,removal-state}.js`
  - argument parsing, dispatch, help/error and finalisation remain at the bin launch path
- `lib/statusline.js`
  - path/model/grant segments → `lib/statusline/segments.js`
  - style/render/data/wrap/main → `lib/statusline/render.js`

## Local proxy

- `proxy-manager.js`
  - opt-out/provider decisions, `probeProxy`, daemon leave/retire/shutdown, port allocation and timing constants → `manager/probe.js`
  - runtime hashing/copying, version comparison, daemon startup, `prepareInstall`, `ensureDefaultProxy` → `manager/install.js`
  - `proxyOn`, session/settings state, override source, routing, recovery and `checkSessionProxy` → `manager/routes.js`
  - settings restoration, proxy stop/removal, orphan cleanup and session-only exit → `manager/orphans.js`
  - runtime status, daemon discovery, diagnosis and repair → `manager/diagnose.js`
- `proxy.js`
  - `scrubBody`, typed-mask notes, body masking, unrestorable recording and `knownValueMasker` → `scrub.js`
  - target validation, upstream failures/forwarding, request handling, `createMaskingProxy`, `listen` → `upstream.js`
- `daemon.js`
  - access-key resolution, `decideRoute`, health/control endpoints and request routing → `daemon/request.js`
  - configuration/network state, retirement, settings restoration, port takeover, timers and signals → `daemon/lifecycle.js`
- `service-manager.js`: `createServiceManager` decomposed into command runner, registrar, unregister, definition parsing and registration-check helpers in the same component entry.

The legacy `decision.roots ?? [decision.root]` masking branch is retained: phase 45 found an existing caller, so the pure-refactor proof required for removal does not exist.

## Tests

Tests moved from the root into `test/host/`, `test/local-proxy/`, `test/shell-analysis/`, or `test/zeroh-disclosure-core/` according to the component they exercise. Names were retained except for finding-era filenames whose finding ids remain in their test titles:

- `astra8-final.test.mjs` → `shell-analysis/destinations-integration.test.mjs`
- `astra9-classes.test.mjs` → `shell-analysis/detection-classes.test.mjs`
- `rc2-astra3-shell.test.mjs` → `shell-analysis/shell-integration.test.mjs`
- `rc2-astra4.test.mjs` → `shell-analysis/guard-integration.test.mjs`
- `rc2-astra3-followup.test.mjs` → `zeroh-disclosure-core/report-followup.test.mjs`
- `rc2-last-stops.test.mjs` → `zeroh-disclosure-core/mask-safety.test.mjs`
- `rc2-ups-pass.test.mjs` → `zeroh-disclosure-core/vault-pass.test.mjs`
- `rc2-a1-pass.test.mjs` → `host/pass-through.test.mjs`
- `rc2-astra3-lifecycle.test.mjs` → `host/lifecycle.test.mjs`
- `rc2-ordinary-work.test.mjs` → `host/ordinary-work-regressions.test.mjs`
- `windows-retest.test.mjs` → `host/platform-regressions.test.mjs`

Added component coverage: `test/shell-analysis/shell-programs.test.mjs` and `test/local-proxy/proxy-state.test.mjs`. `test/regressions.json` and `test/regressions.test.mjs` replace the two hand-maintained release-finding lists.

The Nx target uses `tools/run-disclosure-tests.mjs` to select the root and one-level component test files portably and to set manifest-only mode without POSIX-only shell syntax. Direct `node --test` package consumers continue to use the root regression compatibility entry.
