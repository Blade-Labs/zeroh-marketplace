// SPDX-License-Identifier: AGPL-3.0-only

// Package-facing facade: keep the local-proxy dependency on the host settings
// adapter at one explicit edge as component files are split by concern.
export * from '../../lib/claude-settings.js';
