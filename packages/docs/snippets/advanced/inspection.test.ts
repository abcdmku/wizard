import { expect, it } from 'vitest'
import { inspectProfileRun } from './inspection'

it('rebuilds the same state from the event stream', async () => {
  const result = await inspectProfileRun()

  expect(result.waiting).toMatchObject({ phase: 'waiting', reasons: [] })
  expect(result.rebuilt).toEqual(result.live)
  expect(result.progress).toEqual({ done: 1, total: 1, ratio: 1 })
  expect(result.events.length).toBeGreaterThan(0)
})
