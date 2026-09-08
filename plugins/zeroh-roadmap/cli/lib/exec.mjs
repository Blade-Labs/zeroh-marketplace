/**
 * exec — the injectable process seam derive.mjs and landing.mjs run git / the debt
 * census / the arc-end suite through (arc ROADCODE). Tests inject a recorder to assert
 * the exact argv stream (e.g. landing's "no ':' refspec token ever" proof) and to feed
 * canned exit codes; production uses defaultExec.
 *
 * Contract: exec(file, args, { cwd?, input? }) → { status, stdout, stderr }. NEVER
 * throws on a non-zero exit — the exit code is DATA the caller branches on (honesty
 * rail: exit codes never lie, so they must be observable, not swallowed as exceptions).
 * runCaptured is the ASYNC sibling for a CONSUMER-authored shell command — same honesty
 * rail, plus a budget, because a consumer's own runner may hang.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { readSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// execFileSync's 1 MiB default silently truncates and THEN throws ENOBUFS, which a caller
// reads as "the command failed" — indistinguishable from "the command found nothing". A git
// log over a real repo's history clears 1 MiB easily (the flagship consumer's is ~2.9 MB), so
// the seam carries headroom by default: ~100k commit subjects.
export function defaultExec(file, args, { cwd, input, timeout = 120_000, maxBuffer = 16 * 1024 * 1024 } = {}) {
  try {
    const stdout = execFileSync(file, args, {
      cwd,
      input,
      encoding: 'utf8',
      timeout,
      maxBuffer,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (e) {
    return {
      status: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout?.toString?.() ?? '',
      stderr: e.stderr?.toString?.() ?? String(e.message ?? e),
    }
  }
}

/**
 * Run ONE consumer-authored shell command captured, under a hard budget — the seam the gate's
 * vacuity probe and `phase validate --assumptions` both execute through. The child gets its OWN
 * process group so a timeout kill takes its descendants with it (a runner that spawned a compiler
 * otherwise survives its parent and holds the pipes open). The three outcomes stay DISTINCT:
 * { exitCode } is a command that rendered a verdict, { timedOut } one killed mid-flight, and
 * { spawnError } one that never started — so a caller can never read an UNANSWERED run as a
 * verdict (the vacuous-green class). Captured stdout/stderr ride every outcome and never reach the
 * parent tty. NEVER throws.
 */
export function runCaptured(command, { cwd, timeoutMs = 120_000 } = {}) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now()
    let settled = false
    let timedOut = false
    const child = spawn('bash', ['-c', command], {
      cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ ...result, durationMs: Date.now() - startedAt, stdout, stderr })
    }
    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32') child.kill('SIGKILL')
      else {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }
    }, timeoutMs)
    child.on('error', (error) => finish({ spawnError: error.message }))
    child.on('close', (code) => finish(timedOut ? { timedOut: true } : { exitCode: code ?? 128 }))
  })
}

// Configured argv travels as bounded data through resource wrappers, never as shell text.
function argvStdinMain() {
  try {
    const chunks = [], buffer = Buffer.alloc(8192)
    let length = 0, count
    while ((count = readSync(0, buffer, 0, buffer.length, null)) > 0) {
      length += count
      if (length > 1024 * 1024) throw Error('argv input exceeds 1 MiB')
      chunks.push(Buffer.from(buffer.subarray(0, count)))
    }
    const argv = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!Array.isArray(argv) || !argv.length || !argv.every(value => typeof value === 'string' && !value.includes('\0')) || !argv[0].trim()) throw Error('expected a nonempty NUL-free argv array')
    const result = spawnSync(argv[0], argv.slice(1), { cwd: process.cwd(), shell: false, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 })
    if (result.stdout?.length) writeFileSync(1, result.stdout)
    if (result.stderr?.length) writeFileSync(2, result.stderr)
    if (result.error) {
      writeFileSync(2, 'roadmap argv launcher: ' + result.error.message + '\n')
      process.exitCode = result.error.code === 'ENOENT' ? 127 : result.error.code === 'EACCES' ? 126 : 125
    } else if (result.signal) {
      writeFileSync(2, 'roadmap argv launcher: child signal: ' + result.signal + '\n')
      process.kill(process.pid, result.signal)
    } else if (Number.isInteger(result.status)) process.exitCode = result.status
    else throw Error('child completion is unavailable')
  } catch (error) {
    writeFileSync(2, 'roadmap argv launcher: ' + error.message + '\n')
    process.exitCode = 125
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--argv-stdin') argvStdinMain()
