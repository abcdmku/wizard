import { expect, it } from 'vitest'
import { ingestFlow } from './fanout'

it('joins both branches and lets a skipped branch satisfy the join', async () => {
  const run = ingestFlow.create({ enrichment: 'off' })
  await run.start()

  const result = await run.awaitResult()

  expect(result.status).toBe('done')
  expect(run.getState().steps.enrich.status).toBe('skipped')
  expect(run.getState().steps.normalize.status).toBe('done')
  run.dispose()
})
