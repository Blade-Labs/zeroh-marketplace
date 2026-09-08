/** Consumer-local discovery. Imports use the consumer's vendored schema. */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ArcShape, PhaseShape, type Arc, type Phase } from './schema'

export function roadmapRoot(cwd = process.cwd()): string {
  if (process.env.ROADMAP_ROOT) return path.resolve(cwd, process.env.ROADMAP_ROOT)
  const candidates = ['roadmap', 'docs/roadmap'].filter(p => fs.existsSync(path.join(cwd, p, 'phases')))
  if (candidates.length > 1) throw new Error('Multiple roadmap roots; set ROADMAP_ROOT explicitly')
  return path.resolve(cwd, candidates[0] ?? 'roadmap')
}
async function discover<T>(directory: string, suffix: string, parse: (input: unknown) => T, key: (record: T) => string) {
  const records: T[] = [], errors: {file: string; error: string}[] = []
  if (!fs.existsSync(directory)) return { records, errors }
  const seen = new Map<string, string>()
  for (const name of fs.readdirSync(directory).filter(n => n.endsWith(suffix)).sort()) {
    const file = path.resolve(directory, name)
    try {
      const record = parse((await import(pathToFileURL(file).href)).default)
      const previous = seen.get(key(record))
      if (previous) throw new Error(`Duplicate ${key(record)}: ${previous} and ${file}`)
      seen.set(key(record), file)
      records.push(record)
    } catch (error) { errors.push({ file, error: error instanceof Error ? error.message : String(error) }) }
  }
  return { records, errors }
}
export async function discoverPhases(directory = path.join(roadmapRoot(), 'phases')) {
  const { records: phases, errors } = await discover(directory, '.phase.ts', PhaseShape.parse, p => String(p.phase))
  return { phases, errors }
}
export async function discoverArcs(directory = path.join(roadmapRoot(), 'arcs')) {
  const { records: arcs, errors } = await discover(directory, '.arc.ts', ArcShape.parse, a => String(a.id))
  return { arcs, errors }
}
export function crossValidate(phases: Phase[], arcs: Arc[]): string[] {
  const errors: string[] = [], owners = new Map<number, string>()
  for (const arc of arcs) for (const number of arc.phases) {
    const phase = phases.find(p => p.phase === number)
    if (!phase) errors.push(`Arc ${arc.id} references missing phase ${number}`)
    else {
      if (String(phase.arcId) !== String(arc.id)) errors.push(`Phase ${number} arcId does not match ${arc.id}`)
      if (arc.status === 'done' && phase.status !== 'done') errors.push(`Done arc ${arc.id} has unfinished phase ${number}`)
      for (const criterion of phase.criteria)
        if (!arc.acceptanceCriteria.some(c => c.id === criterion)) errors.push(`Phase ${number} references unknown criterion ${criterion}`)
    }
    if (owners.has(number)) errors.push(`Phase ${number} belongs to multiple arcs`)
    owners.set(number, String(arc.id))
  }
  for (const phase of phases) {
    if (phase.arcId !== undefined && owners.get(phase.phase) !== String(phase.arcId)) errors.push(`Phase ${phase.phase} has missing arc membership`)
    for (const dependency of phase.dependsOn)
      if (!phases.some(p => p.phase === dependency)) errors.push(`Phase ${phase.phase} references missing dependency ${dependency}`)
  }
  return errors
}
