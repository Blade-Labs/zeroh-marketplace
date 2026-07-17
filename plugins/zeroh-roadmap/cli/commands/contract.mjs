/**
 * roadmap contract show --json-schema — thin dispatch shim over cli/commands/result.mjs
 * (seam-3 logic lives in ONE module; this file exists only so the filename-based
 * bin/roadmap.mjs dispatcher mounts the `contract` command).
 */
import { contractRun } from './result.mjs'

export default async function run(argv) {
  return contractRun(argv)
}
