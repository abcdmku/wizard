import { expect, it } from 'vitest'
import { createCallerTracker } from '../src/server/callers'

it('names the item of a mapped step behind each call', () => {
  const tracker = createCallerTracker()
  tracker.observe({ type: 'step.eachStarted', step: 'search', path: [], items: ['a', 'b'] })
  tracker.observe({ type: 'step.eachItemStarted', step: 'search', path: [], index: 0, attempt: 1 })
  tracker.observe({ type: 'step.eachItemStarted', step: 'search', path: [], index: 1, attempt: 1 })
  tracker.called('c1')
  tracker.called('c2')
  expect(tracker.of('c1')).toMatchObject({ step: 'search', item: 0, items: 2 })
  expect(tracker.of('c2')).toMatchObject({ step: 'search', item: 1, items: 2 })
})

it('leaves the item out of a step that does not run per item', () => {
  const tracker = createCallerTracker()
  tracker.observe({ type: 'step.runStarted', step: 'plan', path: [], attempt: 1 })
  tracker.called('c1')
  expect(tracker.of('c1')).toEqual({ step: 'plan', path: [], attempt: 1 })
})
