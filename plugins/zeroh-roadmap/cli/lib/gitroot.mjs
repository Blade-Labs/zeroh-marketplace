/**
 * gitroot — the ONE git-root resolver every CLI module shares (config, claim,
 * sidecar, beacon). Ported from bin/validate-roadmap-file.mjs gitCommonDir/relToRepo
 * and scripts/claim-phase-number.sh's common-dir resolution: execFileSync git with
 * a timeout, never a shell string; a non-repo/bare tree is a thrown typed error,
 * never a guessed path.
 */
import { execFileSync } from 'node:child_process'
import { resolve, dirname, basename } from 'node:path'

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { timeout: 10_000, encoding: 'utf8' }).trim()
}

/** Absolute working-tree root for the repo containing `cwd`. Throws in a non-repo. */
export function gitToplevel(cwd) {
  return git(cwd, ['rev-parse', '--show-toplevel'])
}

/**
 * Absolute git-common-dir for `cwd` — shared across every worktree of the repo, so
 * claims/sidecars land in ONE place. `--git-common-dir` may be relative (a bare
 * `.git`); resolve it against `cwd`. Throws in a non-repo.
 */
export function gitCommonDir(cwd) {
  const out = git(cwd, ['rev-parse', '--git-common-dir'])
  return resolve(cwd, out)
}

/**
 * The MAIN checkout directory = dirname of the common dir (a linked worktree's
 * common dir is `<main>/.git`). This is where the .building sidecar registry lives
 * (beacon-stamp.sh's discovery rule). Throws a typed error for a bare repo, where
 * the common dir is the repo itself and there is no working main checkout.
 */
export function mainCheckout(cwd) {
  const common = gitCommonDir(cwd)
  if (basename(common) !== '.git') {
    throw new Error(
      `roadmap: ${cwd} resolves to a bare repository (git-common-dir ${common}) — `
        + 'the sidecar/claims registry needs a working main checkout',
    )
  }
  return dirname(common)
}
