#!/usr/bin/env node
/**
 * generate-config-schema — writes cli/roadmap.config.schema.json from the ONE Zod
 * shape (z.toJSONSchema(RoadmapConfigShape)). Rerunnable + idempotent: the drift
 * subtest in cli/lib/config.test.mjs regenerates in-memory and deep-equals the
 * committed file, so a stale schema fails plugin CI — the fix is rerunning THIS.
 * The generated file is committed for consumers' "$schema" editor support; it is
 * never hand-edited.
 *
 * Usage: node cli/generate-config-schema.mjs
 */
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { RoadmapConfigShape } from './lib/config.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'roadmap.config.schema.json')

const schema = z.toJSONSchema(RoadmapConfigShape)
writeFileSync(OUT, JSON.stringify(schema, null, 2) + '\n')
console.error(`wrote ${OUT}`)
