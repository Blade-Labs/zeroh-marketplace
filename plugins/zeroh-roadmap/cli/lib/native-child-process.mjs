import { spawn } from 'node:child_process'

/** One invocation, one completion; callers own storage and protocol interpretation. */
export function spawnNativeChild(bin, argv, options) {
  const child = spawn(bin, argv, options)
  const completion = new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, signal: null, error: error.message }))
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  return { child, completion }
}
