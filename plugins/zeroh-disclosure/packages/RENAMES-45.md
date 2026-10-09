# Phase 45 rename map

This phase changes package homes without changing behavior. Every path is relative to the plugin root.

## `zeroh-disclosure-core`

- `lib/vault.js` → `packages/zeroh-disclosure-core/vault.js`
- `lib/restorable.js` → `packages/zeroh-disclosure-core/restorable.js`
- `lib/token-pattern.js` → `packages/zeroh-disclosure-core/token-pattern.js`
- `lib/tokens.js` → `packages/zeroh-disclosure-core/tokens.js`
- `lib/crypto.js` → `packages/zeroh-disclosure-core/crypto.js`
- `lib/signing-key.js` → `packages/zeroh-disclosure-core/signing-key.js`
- `lib/receipt.js` → `packages/zeroh-disclosure-core/receipt.js`
- `lib/receipt-bundle.js` → `packages/zeroh-disclosure-core/receipt-bundle.js`
- `lib/receipt-keep.js` → `packages/zeroh-disclosure-core/receipt-keep.js`
- `lib/receipt-retention.js` → `packages/zeroh-disclosure-core/receipt-retention.js`
- `lib/verify-receipt.js` → `packages/zeroh-disclosure-core/verify-receipt.js`
- `lib/boundary.js` → `packages/zeroh-disclosure-core/boundary.js`
- `lib/turn-summary.js` → `packages/zeroh-disclosure-core/turn-summary.js`
- `lib/detector.js` → `packages/zeroh-disclosure-core/detector.js`
- `lib/data-kinds.js` → `packages/zeroh-disclosure-core/data-kinds.js`
- `lib/mask.js` → `packages/zeroh-disclosure-core/mask.js`
- `lib/unmask.js` → `packages/zeroh-disclosure-core/unmask.js`
- `lib/context-scan.js` → `packages/zeroh-disclosure-core/context-scan.js`
- `lib/pdf-text.js` → `packages/zeroh-disclosure-core/pdf-text.js`
- `lib/private-fs.js` → `packages/zeroh-disclosure-core/private-fs.js`
- `lib/config.js` → `packages/zeroh-disclosure-core/config.js`
- `lib/session.js` → `packages/zeroh-disclosure-core/session.js`
- `lib/session-status.js` → `packages/zeroh-disclosure-core/session-status.js`
- `lib/report.js` → `packages/zeroh-disclosure-core/report.js`
- `lib/report-html.js` → `packages/zeroh-disclosure-core/report-html.js`
- `lib/report-counts.js` → `packages/zeroh-disclosure-core/report-counts.js`
- `lib/report-store.js` → `packages/zeroh-disclosure-core/report-store.js`
- `lib/report-slip.js` → `packages/zeroh-disclosure-core/report-slip.js`
- `lib/report-miss.js` → `packages/zeroh-disclosure-core/report-miss.js`
- `lib/transcript-files.js` → `packages/zeroh-disclosure-core/transcript-files.js`
- `lib/unchecked.js` → `packages/zeroh-disclosure-core/unchecked.js`
- `lib/disclosure.js` → `packages/zeroh-disclosure-core/disclosure.js`
- `lib/selective-disclosure.js` → `packages/zeroh-disclosure-core/selective-disclosure.js`
- `lib/policy.js` → `packages/zeroh-disclosure-core/policy.js`
- `lib/policies/zeroh-disclosure.v1.js` → `packages/zeroh-disclosure-core/policies/zeroh-disclosure.v1.js`
- `lib/protection-engines/regex-local.js` → `packages/zeroh-disclosure-core/protection-engines/regex-local.js`
- `lib/tool-policies.js` → `packages/zeroh-disclosure-core/tool-policies.js`
- `lib/user-authority.js` → `packages/zeroh-disclosure-core/user-authority.js`
- `lib/plugin-integrity.js` → `packages/zeroh-disclosure-core/plugin-integrity.js`
- `lib/plugin-removal.js` → `packages/zeroh-disclosure-core/plugin-removal.js`
- `lib/uninstall-marker.js` → `packages/zeroh-disclosure-core/uninstall-marker.js`
- `lib/fix-command.js` → `packages/zeroh-disclosure-core/fix-command.js`
- `lib/allow-rules.js` → `packages/zeroh-disclosure-core/allow-rules.js`

## `shell-analysis`

- `lib/shell-scan.js` → `packages/shell-analysis/shell-scan.js`
- `lib/shell-tools.js` → `packages/shell-analysis/shell-tools.js`
- `lib/shell-references.js` → `packages/shell-analysis/shell-references.js`
- `lib/shell-programs.js` → `packages/shell-analysis/shell-programs.js`
- `lib/shell-destinations.js` → `packages/shell-analysis/shell-destinations.js`
- `lib/settings-guard.js` → `packages/shell-analysis/settings-guard.js`
- `lib/secrets.js` → `packages/shell-analysis/secrets.js`
- `lib/allow-list.js` → `packages/shell-analysis/allow-list.js`
- `lib/late-bind.js` → `packages/shell-analysis/late-bind.js`
- `lib/exit-status.js` → `packages/shell-analysis/exit-status.js`

## `local-proxy`

- `lib/proxy-state.js` → `packages/local-proxy/proxy-state.js`
- `lib/proxy-manager.js` → `packages/local-proxy/proxy-manager.js`
- `lib/proxy.js` → `packages/local-proxy/proxy.js`
- `lib/proxy-report.js` → `packages/local-proxy/proxy-report.js`
- `lib/loopback.js` → `packages/local-proxy/loopback.js`
- `lib/network.js` → `packages/local-proxy/network.js`
- `lib/service-manager.js` → `packages/local-proxy/service-manager.js`
- `bin/proxy-daemon.mjs` → `packages/local-proxy/daemon.js` (the original path remains as a launcher)
