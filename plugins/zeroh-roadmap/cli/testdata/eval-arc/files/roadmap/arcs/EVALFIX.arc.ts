import { defineArc } from '../../lib/roadmap/schema.js'

/** EVALFIX — the synthetic two-plane arc the eval-engine fixtures collect and score. */
export default defineArc({
  id: 'EVALFIX',
  name: 'the eval fixture arc',
  baseRef: 'develop',
  singleSeams: ['one collector reads every persisted eval input, no second reader'],
  honestyRails: ['an absent artifact is an absent field, never a fabricated zero'],
  acceptanceCriteria: [
    {
      id: 'c1',
      job: 'collect an arc trace from disk alone, with no chat history',
      surfaces: ['cli'],
      signal: 'the trace names both member phases with their execution results',
      tier: 'wired',
      bar: 'a reader can tell absent data from zero data at a glance',
    },
    {
      id: 'c2',
      job: 'score the collected trace deterministically',
      surfaces: ['cli'],
      signal: 'every deterministic dimension carries sourceRefs',
      tier: 'wired',
      bar: 'no dimension silently reports a zero for missing data',
    },
    {
      id: 'c3',
      job: 'read the timing table before planning a phase',
      surfaces: ['cli'],
      signal: 'the cohort table names its surface heuristic',
      tier: 'live-ui',
      bar: 'the excluded interrupted phases are counted visibly',
    },
  ],
  planes: [
    { name: 'engine', phases: [9001] },
    { name: 'surface', phases: [9002] },
  ],
  status: 'merged',
})
