// Bounded argv-only reads of Git state; never run consumer tests here.
import { execFileSync } from 'node:child_process'
export function defaultExec(file, args, { cwd, input, timeout = 10000, maxBuffer = 16 * 1024 * 1024 } = {}) {
  try { return { status: 0, stdout: execFileSync(file, args, { cwd, input, timeout, maxBuffer, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }), stderr: '' } }
  catch (error) { return { status: Number.isInteger(error.status) ? error.status : 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr || error.message) } }
}
