/** Read-only JSON progress: npx tsx roadmap/lib/emit.ts. Never hides invalid files. */
import { crossValidate, discoverArcs, discoverPhases } from './registry'

async function main() {
  const [{ phases, errors }, { arcs, errors: arcErrors }] = await Promise.all([discoverPhases(), discoverArcs()])
  const problems = [...errors, ...arcErrors, ...crossValidate(phases, arcs).map(error => ({ error }))]
  console.log(JSON.stringify({ phases, arcs, errors: problems }, null, 2))
  if (problems.length) process.exitCode = 1
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
