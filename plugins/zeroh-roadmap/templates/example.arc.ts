/** Reference only: author member phases before adding this arc to the active roadmap.
 * Commit the approved intent; then set intentRef to that commit:path before execution.
 * Deferred criteria remain promises. Replenish the next window within approved scope. */
import { defineArc } from '../lib/schema'
export default defineArc({
  id: 'PROTOTYPE', name: 'First usable prototype',
  intent: 'A user completes the main journey with real data.',
  scope: ['One local runnable application and its first user journey'],
  nonGoals: ['Production deployment, billing, or additional platforms'],
  assumptions: [{ claim: 'The existing stack can support the journey', check: 'Run the smallest local integration', onFalse: 'replan' }],
  acceptanceCriteria: [
    { id: 'prototype-runs', description: 'A fresh checkout starts using documented commands.' },
    { id: 'first-user-journey', description: 'A user completes the journey; failures have a useful message.' },
  ],
  phases: [],
  planning: { mode: 'rolling', windowSize: 2, deferredCriteria: ['prototype-runs', 'first-user-journey'] },
})
