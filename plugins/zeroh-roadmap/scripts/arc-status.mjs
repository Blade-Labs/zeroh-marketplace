#!/usr/bin/env node
// DEPRECATED (ROADCODE 1655) — absorbed by `roadmap status`; shim removed at the 1661 cutover.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const bin = fileURLToPath(new URL('../bin/roadmap.mjs', import.meta.url))
process.exit(spawnSync(process.execPath, [bin, 'status', ...process.argv.slice(2)], { stdio: 'inherit' }).status ?? 1)
