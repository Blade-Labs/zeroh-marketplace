# Roadmap 0.40.0 / Greenfield 1.0.0 release review

Owner ruling, 2026-09-06: review whether the candidate restores idea-to-runnable-prototype development with a sound foundation, then release if aligned. R0/#07 remains the top release requirement. No new arc or paid native matrix is required.

## Product verdict

Independent purpose review: CLEAR after repairs. The workflow reuses settled interview answers, preserves the selected stack, proposes a minimal runnable foundation with architecture and a meaningful test, and offers CI/release infrastructure only when selected. Existing repositories preserve valid homes and can adopt individual improvements or decline.

Large executable writers are saved once and syntax/interpreter/target state is checked before mutation. Execution reads the checked bytes and returns the real process exit. The artifact and `--approved` acknowledgment are not an authorization sandbox; host/user approval remains authoritative. Simple commands stay direct. No locks, journal, crash-recovery workflow engine, or rollback promise was added.

## Findings and fixes

- Independent code review found that deleted shared configuration could disappear from arc test scope. The range fallback now retains deletions; a planted regression failed before the fix and passed afterward. Landing suite: 55/55.
- Independent purpose review found that fixed example generators/design choices could override the approved stack. Init now adapts examples to the chosen stack and compatible design. Recheck: CLEAR.
- The same review found repeat questioning of an explicit stack selection and reason. The decision workflow now reuses settled choices. Recheck: CLEAR.
- Release inspection found synthetic wrapper validation depended on the maintainer's installed capbuild file. Explicit fixture filesystem/UID inputs remove this CI dependency; native validation defaults still check the real executable, bytes, path, permissions and host effects. Focused affected checks: 61/61, no skips/cancellations.

## Evidence and its limits

- R0 focused verification before release review: 164 checks passed.
- One real Codex/Astra CLI foundation pilot passed at snapshot `ddbe1c6348b0a183565336ff14b6960f67a5123dff086b122fdac9e0fcfb1504`: 640.280 seconds native time, zero consumer writes during proposal and final audit. Retained at `plugins/zeroh-greenfield/dry-runs/evidence/r0-local-foundation-pilot/`. Subsequent reviewed repairs mean this is not a final-source pilot. No broad performance claim.
- Four earlier Claude/Codex empty/brownfield delivery observations are historical source-bound evidence. Receipts and exact audit assertions are preserved. No final-source four-case native coverage is claimed.
- `npm run test:native-evidence` is an explicit recorded-environment audit: 8/9 passed; freshness correctly rejected changed source. This RED result is disclosed, not relabeled or counted as release regression success.
- The default suite retains synthetic tampering, source binding, approval, command identity, real-exit, selected-delivery and workflow mutation checks. Only recorded-environment audits moved out of ordinary discovery.
- Owner-accepted earlier mobile decision-output and web/Blade wiring evidence gaps remain in Arc.descopes. Native fixtures do not prove all SDKs, hosted CI, external attestation or deployment.
- Full configured release gate: PENDING. Require terminal TAP totals plus schema `PASS — 0 failure(s)`. Interrupted run 000016 is excluded: systemd stopped capbuild, which returned misleading exit zero without terminal completion. Earlier red/failed attempts are retained.
- Manifest drift check and Claude Greenfield manifest validation passed (one nonblocking category warning). Protocol-load budget: 11,065 / 12,000 tokens.

## Release scope

This explicitly supersedes the mandatory current-source four-arm refresh in older phase/closure wording under the latest owner release instruction and the architect's PROCEED_WITH_FIX ruling. Phase 34.7 records the same amendment. Keep historical failed attempts; do not rewrite their digests.

Release-sweep census is currently a CLI stub; no census success is claimed. Existing typed debts/accepted evidence exceptions remain open or recorded as before; nothing is archived or silently dismissed. Full native Roadmap lifecycle modernization and the remaining bounded efficiency priorities stay outside this release. NATIVEGREEN execution remains unauthorized; no Herder notice is due until both arcs are released.
