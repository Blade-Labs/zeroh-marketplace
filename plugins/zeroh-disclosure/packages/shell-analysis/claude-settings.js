// SPDX-License-Identifier: AGPL-3.0-only

// Package-facing facade: keep the shell-analysis dependency on the host
// settings adapter at one explicit edge as guard concerns are split.
export { resolveClaudeSettingsPath } from '../../lib/claude-settings.js';
