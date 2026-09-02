/**
 * roadmap-root — THE answer to "where is this consumer's roadmap?", and the ONLY module
 * under cli/ or hooks/ allowed to spell the root as a literal (cli/lib/roadmap-root.test.mjs
 * scans for it; every other site joins onto what these functions return).
 *
 * Two homes, discovered rather than configured: the config lives INSIDE the root, so a
 * roadmap.config.json key could never name it. `roadmap/` at the git toplevel is what every
 * consumer has today and stays first; `docs/roadmap/` is the second candidate, for a repo that
 * keeps its workflows as sibling doc folders (docs/roadmap/ beside docs/superpowers/).
 *
 * The rules, in order:
 *  - ROADMAP_ROOT wins, absolute or resolved against `dir`, and is NOT probed — an override
 *    names where the root WILL be, so `roadmap init` can scaffold into it.
 *  - else the first candidate carrying a MARKER (roadmap.config.json or phases/). An existing
 *    but unmarked directory is not a marker: a repo with a prose docs/roadmap/ folder must
 *    keep reading its real roadmap/.
 *  - both marked → RoadmapRootError('ambiguous'), never a silent pick. Two roots means two
 *    backlogs, two claim registries and two gate directories; guessing one is how half a
 *    consumer's records go quietly unread.
 *  - neither marked → the default first candidate, so a fresh or non-consumer tree answers
 *    exactly what it answered before this module existed.
 */
import { existsSync } from 'node:fs'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { BridgeError } from './bridge-error.mjs'

/** The root homes, in PRECEDENCE order. Extending this list extends discovery everywhere. */
export const ROOT_CANDIDATES = ['roadmap', 'docs/roadmap']

/** What makes a candidate directory a roadmap root rather than a same-named prose folder. */
const MARKERS = ['roadmap.config.json', 'phases']

/** Typed root-resolution failure. kind ∈ 'ambiguous'. Same shape as ConfigError. */
export class RoadmapRootError extends Error {
  constructor(kind, messageLines) {
    super(messageLines.join('\n'))
    this.name = 'RoadmapRootError'
    this.kind = kind
    this.messageLines = messageLines
  }
}

/** [dir, override] → resolved root. Keyed on both: a memo keyed on dir alone
 *  would hand a later caller an answer the current ROADMAP_ROOT never authorized. */
const memo = new Map()

/**
 * Drop every memoized resolution. For tests and long-lived processes that MUTATE a tree
 * (scaffolding a root, then resolving it) — the probes are fs reads, and a cached miss
 * outlives the directory that caused it.
 */
export function resetRoadmapRootCache() {
  memo.clear()
}

/** The override in force, or null. An empty ROADMAP_ROOT is unset, not "the cwd". */
function override() {
  const raw = process.env.ROADMAP_ROOT
  return raw != null && raw !== '' ? raw : null
}

const isRoot = (candidateDir) => MARKERS.some((m) => existsSync(join(candidateDir, m)))

/**
 * The consumer's roadmap data root for the tree at `dir` (normally a git toplevel).
 * @param {string} dir
 * @returns {string} an ABSOLUTE directory path
 * @throws {RoadmapRootError} kind 'ambiguous' when more than one candidate is marked
 */
export function roadmapRoot(dir) {
  const env = override()
  const key = JSON.stringify([dir, env])
  const hit = memo.get(key)
  if (hit !== undefined) return hit

  // The override is checked BEFORE the ambiguity refusal on purpose: it is the remedy that
  // refusal advertises, and a remedy resolved after the throw could never be taken.
  const resolved = env ? (isAbsolute(env) ? env : resolve(dir, env)) : probe(dir)
  memo.set(key, resolved)
  return resolved
}

function probe(dir) {
  const marked = ROOT_CANDIDATES.map((c) => resolve(dir, c)).filter(isRoot)
  if (marked.length > 1) {
    throw new RoadmapRootError('ambiguous', [
      `roadmap: ${dir} carries more than one roadmap root — ${marked.join(' and ')}`,
      `each holds its own records, so reading either one silently hides the other. Delete or merge the one that is not yours, or name the real root: ROADMAP_ROOT=<dir> roadmap <command>`,
    ])
  }
  return marked[0] ?? resolve(dir, ROOT_CANDIDATES[0])
}

/**
 * The same answer spelled RELATIVE to `dir`, POSIX-separated and with no trailing slash —
 * what git pathspecs (`git log -- <rel>/backlog.ts`), diff-path prefix tests and the
 * repo-relative provenance strings cited in eval reports all need. Throws exactly where
 * roadmapRoot throws: an ambiguous tree must never be handed a guessed pathspec.
 * @param {string} dir
 * @returns {string} e.g. 'roadmap' or 'docs/roadmap'
 */
export function roadmapRootRel(dir) {
  const rel = relative(dir, roadmapRoot(dir))
  return sep === '/' ? rel : rel.split(sep).join('/')
}

/**
 * The consumer's vendored schema seam — what the tsx bridge validates every typed roadmap
 * file through. Root-first (`<root>/lib/schema.ts`, what a consumer scaffolded from now on
 * carries, reachable by a relative import with no tsconfig alias), then the LEGACY
 * `<dir>/lib/roadmap/schema.ts` that every existing consumer still has.
 * @param {string} dir  a consumer root (git toplevel)
 * @returns {string} an absolute path to an existing file
 * @throws {BridgeError} kind 'schema-missing', naming BOTH candidates
 */
export function consumerSchemaPath(dir) {
  const rootSeam = join(roadmapRoot(dir), 'lib', 'schema.ts')
  if (existsSync(rootSeam)) return rootSeam
  const legacySeam = join(dir, 'lib', 'roadmap', 'schema.ts')
  if (existsSync(legacySeam)) return legacySeam
  throw new BridgeError('schema-missing', [
    `roadmap: no consumer schema at ${rootSeam} (nor at the legacy seam ${legacySeam}) — this repo is not a roadmap consumer`,
  ])
}
