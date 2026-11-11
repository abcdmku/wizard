/**
 * Runnable walk-through: `pnpm --filter example-07-dag-pipeline start`.
 * Prints the static graph, then a timeline of the run: both branches start together, the gate
 * waits for both (explain() shows why), then persist → done.
 */
import { inspect } from '@openwizard/core/inspect'
import { createTestScheduler } from '@openwizard/core/testing'
import { type Deps, pipeline } from './pipeline'

const graph = inspect(pipeline)
console.log('edges:')
for (const e of graph.edges)
  console.log(`  ${(e.from ?? '(start)').padEnd(10)} → ${e.to.padEnd(10)} ${e.kind}`)

const scheduler = createTestScheduler({ now: 0 })
const after = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => scheduler.setTimeout(() => resolve(value), ms))
const deps: Deps = {
  source: { fetch: () => ({ rows: 100 }) },
  normalizer: { run: (rows) => after(300, { normalized: rows }) },
  enricher: { run: (rows) => after(500, { enriched: rows, quality: 0.9 }) },
  warehouse: { write: () => ({ batchId: 'b-1' }) },
}
const run = pipeline.create({ source: 'crm-export' }, { deps, scheduler })
run.observe((event) => {
  if (event.type === 'step.runStarted' || event.type === 'step.done')
    console.log(`t=${String(scheduler.now()).padStart(3)}  ${event.type.padEnd(16)} ${event.step}`)
})

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
await run.start()
console.log(`t=${scheduler.now()}  explain(gate): ${run.explain('gate').reasons.join(', ')}`)
scheduler.advance(300)
await settle()
console.log(
  `t=${scheduler.now()}  explain(gate): ${run.explain('gate').reasons.join(', ')} (phase ${run.explain('gate').phase})`,
)
scheduler.advance(200)
await settle()
console.log('status:', run.getState().status, '| output:', run.getState().output)
run.dispose()
