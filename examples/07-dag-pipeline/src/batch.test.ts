import { describe, expect, it } from 'vitest'
import { type BatchDeps, batch } from './batch'

describe('07 mapped batch: ordered outputs and partial recovery', () => {
  it('keeps finished items through a restart and retries only the failed item', async () => {
    const calls: string[] = []
    let unavailable = true
    const deps: BatchDeps = {
      convert: async (item) => {
        calls.push(item.id)
        if (item.id === 'first' && unavailable) {
          // Let the second item finish first, then fail the first item.
          await new Promise((resolve) => setTimeout(resolve, 0))
          throw new Error('converter unavailable')
        }
        return item.value * 10
      },
    }
    const run = batch.create(
      {
        items: [
          { id: 'first', value: 1 },
          { id: 'second', value: 2 },
        ],
      },
      { deps },
    )
    await run.start()
    const outcome = await run.awaitOutcome()
    expect(outcome.status).toBe('halted')
    expect(calls).toEqual(['first', 'second'])
    const snapshot = run.getSnapshot()
    run.dispose()

    unavailable = false
    const resumed = batch.resume(snapshot, { deps })
    expect(await resumed.retry('converted')).toMatchObject({ ok: true })
    const result = await resumed.awaitResult()
    expect(result).toMatchObject({ status: 'done', output: 30 })
    expect(resumed.getState().steps.converted.output).toEqual([10, 20])
    expect(calls).toEqual(['first', 'second', 'first'])
    resumed.dispose()
  })
})
