import { execFileSync } from 'node:child_process'
import { closeSync, constants, fstatSync, openSync } from 'node:fs'

// Keep the lock inode: unlinking it could give concurrent writers different mutexes.
export function withFileLock(path, fn, { label = 'file', timeoutMs = 10_000, ErrorType = Error } = {}) {
  let fd
  try {
    fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
    if (!fstatSync(fd).isFile()) throw new ErrorType(`${label} lock must be a regular file`)
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        // The helper shares our open-file description; closing our FD releases its flock.
        execFileSync('flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd] })
        break
      } catch (error) {
        if (error.status !== 1) throw new ErrorType(`kernel ${label} lock unavailable: ${error.message}`)
        if (Date.now() >= deadline) throw new ErrorType(`${label} lock busy after ${timeoutMs}ms`)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
      }
    }
    return fn()
  } finally { if (fd !== undefined) closeSync(fd) }
}
