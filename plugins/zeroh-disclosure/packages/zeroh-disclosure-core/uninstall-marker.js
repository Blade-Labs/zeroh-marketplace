// SPDX-License-Identifier: AGPL-3.0-only

// Compatibility entry point: every consumer, including the loader and status
// line, shares the atomic pending/committed rule in uninstall-handoff.js.
export * from './uninstall-handoff.js';
