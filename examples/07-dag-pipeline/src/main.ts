/**
 * Runnable walk-through: `pnpm --filter example-07-dag-pipeline start`.
 * Prints the static graph, then a timeline of the run: both branches start together, the gate
 * waits for both (explain() shows why), then persist → done.
 */
import { createWizard, inspect } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { type Deps, pipeline } from './pipeline'

const graph = inspect(pipeline)
console.log('edges:')
for (const e of graph.edges)
  console.log(`  ${(e.from ?? '(start)').padEnd(10)} → ${e.to.padEnd(10)} ${e.kind}`)

const sched = createTestScheduler({ now: 0 })
const after = <T>(ms: number, value: T) =>
  new Promise<T>((r) => sched.setTimeout(() => r(value), ms))
const deps: Deps = {
  source: { fetch: () => ({ rows: 100 }) },
  normalizer: { run: (rows) => after(300, { normalized: rows }) },
  enricher: { run: (rows) => after(500, { enriched: rows, quality: 0.9 }) },
  warehouse: { write: () => ({ batchId: 'b-1' }) },
}
const wizard = createWizard(pipeline, { context: { source: 'crm-export' }, deps, scheduler: sched })
wizard.observe((event) => {
  if (event.type === 'step.runStarted' || event.type === 'step.done')
    console.log(`t=${String(sched.now()).padStart(3)}  ${event.type.padEnd(16)} ${event.step}`)
})

const settle = () => new Promise<void>((r) => setTimeout(r, 0))
await wizard.start()
console.log(`t=${sched.now()}  explain(gate): ${wizard.explain('gate').reasons.join(', ')}`)
sched.advance(300)
await settle()
console.log(
  `t=${sched.now()}  explain(gate): ${wizard.explain('gate').reasons.join(', ')} (phase ${wizard.explain('gate').phase})`,
)
sched.advance(200)
await settle()
console.log('status:', wizard.getState().status, '| output:', wizard.getState().output)
wizard.dispose()
