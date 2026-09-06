// Failure hints and bounded retries over existing gate reports, not a new journal.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, openSync, readSync, closeSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'

const digest = value => createHash('sha256').update(value).digest('hex')
const nextSteps = {
  product: 'Inspect the named failing check, repair the behavior, and verify the affected test.',
  tooling: 'Check the named executable, dependency, path or configuration; repair that prerequisite before retrying.',
  resource: 'Inspect the resource limit or timeout and current capacity before changing the workload or its bound.',
  'authority-quota': 'Check the reported permission, credentials or quota. Reuse existing authority; obtain only a genuinely missing ruling.',
  unknown: 'Inspect the raw log and operation state before retrying; interruption or absent diagnostics is not success.',
}

export function diagnoseFailure({ exitCode, signal = null, output = '' }) {
  if (exitCode === 0 && !signal) return null
  const text = output.slice(-65536)
  let category = 'unknown'
  if (/out of memory|oom.kill|heap out of memory|timed? out|timeout exceeded|ETIMEDOUT/i.test(text)) category = 'resource'
  else if (/rate.limit|quota|HTTP 429|too many requests|unauthori[sz]ed|forbidden|EACCES|permission denied/i.test(text)) category = 'authority-quota'
  else if (exitCode === 127 || /command not found|Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|ENOENT|npm error code|could not determine executable/i.test(text)) category = 'tooling'
  else if (/not ok \d+|ERR_ASSERTION|AssertionError|SyntaxError|TypeError|ReferenceError|error TS\d+/i.test(text)) category = 'product'
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '')
  const lines = clean.split(/\r?\n/)
  const headline = lines.find(line => /not ok \d+|Error:|error:|npm error code|command not found|out of memory|quota|rate.limit|timed? out|permission denied/i.test(line))
    ?? (signal ? `Interrupted by ${signal}` : `Exit ${exitCode}; no recognized diagnostic`)
  const summary = headline.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 500)
  const stable = summary.replace(/\bnot ok \d+/g, 'not ok').replace(/\/tmp\/[^\s'"`]+/g, '/tmp/<fixture>').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>')
  return { category, summary, nextStep: nextSteps[category], signature: digest(JSON.stringify([category, exitCode, signal, stable])) }
}

// Actual source bytes determine progress. Bounds keep diagnostics cheap; an
// unreadable/oversized tree is unknown and cannot silently reset a retry limit.
export function gateInputKey(root, { exclude = [] } = {}) {
  try {
    const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 10000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
    const hash = createHash('sha256')
    const pathspec = ['.', ...exclude.map(path => `:(exclude)${path}`)]
    const files = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...pathspec]).split('\0').filter(Boolean))].sort()
    if (files.length > 20000) return null
    const buffer = Buffer.alloc(65536)
    let bytes = 0
    for (const path of files) {
      const abs = join(root, path)
      let stat
      try { stat = lstatSync(abs) } catch (error) {
        if (error.code === 'ENOENT') continue // Deleted files have no effective input bytes.
        throw error
      }
      if (!stat.isFile() && !stat.isSymbolicLink()) return null
      bytes += stat.size
      if (bytes > 128 * 1024 * 1024) return null
      hash.update(JSON.stringify([path, stat.isSymbolicLink() ? 'link' : stat.mode & 0o111, stat.size]) + '\0')
      if (stat.isSymbolicLink()) hash.update(readlinkSync(abs))
      else {
        const fd = openSync(abs, 'r')
        try {
          let size
          while ((size = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size))
        } finally { closeSync(fd) }
      }
      hash.update('\0')
    }
    return hash.digest('hex')
  } catch { return null }
}

export function retryDecision(reports, inputKey, commands) {
  const failures = []
  for (const command of commands) {
    const attempts = reports.map(report => ({ report, row: report.slots.find(row => row.slot === command.slot && row.command === command.command) })).filter(item => item.row).slice(0, 2)
    if (attempts.length < 2) continue
    const [last, prior] = attempts
    if (!last.row.failure || !prior.row.failure || last.row.exitCode === 0 || prior.row.exitCode === 0) continue
    if (inputKey && [last, prior].some(item => item.report.attempt?.inputKey && item.report.attempt.inputKey !== inputKey)) continue
    if (last.row.failure.signature === prior.row.failure.signature) failures.push(last.row)
  }
  return { blocked: failures.length > 0, failures }
}
