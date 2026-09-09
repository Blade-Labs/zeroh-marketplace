/**
 * roadmap claim [roadmap-root] [--count N] — atomically reserve the next free phase
 * number(s). Ported from scripts/claim-phase-number.sh (locked decision 5 keeps atomic
 * number claims). CREATION is the lock: writeFileSync(<N>.claim, '', { flag: 'wx' }) —
 * wx is noclobber; a concurrent loser gets EEXIST and retries at N+1. Claims land in the
 * git COMMON dir (<common>/zeroh-roadmap-claims) so they are SHARED across all worktrees;
 * a non-repo root falls back to the legacy per-dir <root>/phases/.claims.
 *
 * Prints ONLY the claimed number(s) on stdout, one per line — callers capture stdout.
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gitCommonDir } from '../lib/gitroot.mjs'
import { maxDeclaredPhase, maxRemotePhase } from '../lib/phasescan.mjs'
import { defaultExec } from '../lib/exec.mjs'
import { defaultRoadmapRoot } from '../lib/roadmap-root.mjs'

const RUNAWAY = 1_000_000

function maxClaim(dir) {
  if (!existsSync(dir)) return 0
  let max = 0
  for (const f of readdirSync(dir)) {
    const m = f.match(/^(\d+)\.claim$/)
    if (m) {
      const n = Number(m[1])
      if (n > max) max = n
    }
  }
  return max
}

export default async function run(argv) {
  if (argv.includes('--work')) return claimWork(argv)
  let count = 1
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--count') {
      count = Number(argv[++i])
      if (!Number.isInteger(count) || count < 1) {
        process.stderr.write(`roadmap claim: --count must be a positive integer\n`)
        return 1
      }
    } else if (!argv[i].startsWith('--')) {
      positional.push(argv[i])
    }
  }
  const root = positional[0] ? resolve(positional[0]) : defaultRoadmapRoot(process.cwd())
  const phasesDir = join(root, 'phases')
  if (!existsSync(phasesDir)) {
    process.stderr.write(`roadmap claim: no such dir: ${phasesDir}\n`)
    return 1
  }

  const legacyClaimsDir = join(phasesDir, '.claims')
  let claimsDir
  try {
    claimsDir = join(gitCommonDir(root), 'zeroh-roadmap-claims')
  } catch {
    claimsDir = legacyClaimsDir // non-repo fallback (single-checkout use)
  }
  mkdirSync(claimsDir, { recursive: true })

  // Max across active + archived phase files (declared value) AND outstanding claims
  // in BOTH dirs — an uncommitted reservation is still taken.
  let max = maxDeclaredPhase([phasesDir, join(root, 'archive')])
  max = Math.max(max, maxClaim(claimsDir), maxClaim(legacyClaimsDir))

  // REMOTE collision guard (1792.5): a sibling session may have PUSHED a phase this checkout
  // has not fetched — claiming over it is the recurring renumber. Best-effort: fetch the
  // upstream, read its declared max, fold it in. Offline/no-upstream degrades LOUD (stderr,
  // never stdout — callers capture the numbers) to local-only, never a hard failure.
  const upstream = defaultExec('git', ['rev-parse', '--abbrev-ref', '@{u}'], { cwd: root, timeout: 15_000 })
  if (upstream.status === 0 && upstream.stdout.trim()) {
    const ref = upstream.stdout.trim()
    const fetched = defaultExec('git', ['fetch', '--quiet', ref.split('/')[0], ref.split('/').slice(1).join('/')], { cwd: root, timeout: 30_000 })
    if (fetched.status !== 0) process.stderr.write(`roadmap claim: could not fetch ${ref} — claiming against the LOCAL tree only\n`)
    const remoteMax = maxRemotePhase(root, ref, defaultExec)
    if (remoteMax > max) {
      process.stderr.write(`roadmap claim: ${ref} declares phase ${remoteMax} (ahead of this checkout) — claiming above it\n`)
      max = remoteMax
    }
  } else {
    process.stderr.write('roadmap claim: no upstream for the current branch — claiming against the LOCAL tree only\n')
  }

  const claimed = []
  let N = max + 1
  while (claimed.length < count) {
    if (N > RUNAWAY) {
      process.stderr.write(`roadmap claim: runaway retry loop — inspect ${claimsDir}\n`)
      return 2
    }
    try {
      writeFileSync(join(claimsDir, `${N}.claim`), '', { flag: 'wx' }) // wx = noclobber; creation IS the lock
      claimed.push(N)
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        N++
        continue
      }
      throw e
    }
    N++
  }
  process.stdout.write(claimed.join('\n') + '\n')
  return 0
}

// Serialize work-claim mutations. A crashed lock is held for explicit operator repair;
// no age/PID heuristic may take over another session's work.
function claimWork(argv) {
  const get = flag => { const index = argv.indexOf(flag); return index < 0 ? undefined : argv[index + 1] }
  const id = get('--work'), owner = get('--owner')
  if (!id || !owner || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(id) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(owner)) throw new Error('--work ID and --owner SESSION require simple stable identifiers')
  const positional = argv.filter((arg, i) => !['--work', '--owner', '--release'].includes(arg) && !['--work','--owner'].includes(argv[i - 1]))
  if (positional.length > 1 || positional.some(arg => arg.startsWith('--'))) throw new Error('Unknown work-claim arguments')
  const root = positional.length ? resolve(positional[0]) : defaultRoadmapRoot(process.cwd())
  const dir = join(gitCommonDir(root), 'zeroh-roadmap-work-claims')
  mkdirSync(dir, { recursive: true })
  const lock = join(dir, `${id}.lock`), path = join(dir, `${id}.json`)
  try { mkdirSync(lock) } catch (error) { if (error.code === 'EEXIST') throw new Error(`Ownership mutation held for ${id}. Retry after the other operation; if interrupted, inspect and explicitly repair ${lock}. No automatic reclaim.`); throw error }
  try {
    const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
    if (previous && previous.owner !== owner) throw new Error(`${id} belongs to ${previous.owner}; explicit checked handoff required`)
    if (argv.includes('--release')) {
      if (!previous) throw new Error(`No ownership claim exists for ${id}`)
      unlinkSync(path); console.log(JSON.stringify({ id, owner, released: true }))
    } else {
      const claim = previous ?? { id, owner, root, claimedAt: new Date().toISOString() }
      if (!previous) writeFileSync(path, JSON.stringify(claim) + '\n', { flag: 'wx', mode: 0o600 })
      console.log(JSON.stringify(claim))
    }
    return 0
  } finally { rmdirSync(lock) }
}
