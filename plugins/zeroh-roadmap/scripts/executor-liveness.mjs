#!/usr/bin/env node
// DEPRECATED (ROADCODE 1657) — absorbed by `roadmap watch --once`; shim removed at 1661.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const bin = fileURLToPath(new URL('../bin/roadmap.mjs', import.meta.url))
process.exit(spawnSync(process.execPath, [bin, 'watch', '--once', ...process.argv.slice(2)], { stdio: 'inherit' }).status ?? 1)
