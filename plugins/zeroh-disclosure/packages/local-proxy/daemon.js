#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Stable daemon entry; importing lifecycle starts the configured daemon.
export { decideRoute } from './daemon/lifecycle.js';
