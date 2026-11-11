import { expect, it } from 'vitest'
import { createSequentialIds } from '../../src/interpreter/env'
import { createInterpreter } from '../../src/interpreter/interpreter'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { initialState } from '../../src/machine/index'
import { flow, view } from '../helpers/fixtures'

it('aborts the target guard when cancellation closes its navigation transaction', () => {
  let signal: AbortSignal | undefined
  const def = flow({
    start: 'a',
    steps: {
      a: view({ next: 'b' }),
      b: view({
        canEnter: (args) => {
          signal = args.signal
          return new Promise<boolean>(() => {})
        },
      }),
    },
  })
  const scheduler = createTestScheduler({ now: 100 })
  const ids = createSequentialIds()
  const interpreter = createInterpreter({
    def,
    path: [],
    env: { clock: scheduler, scheduler, ids },
    initialState: initialState(
      { def, path: [], now: scheduler.now, id: ids.id },
      { instanceId: 'cancel-nav', context: {}, now: 100 },
    ),
  })
  interpreter.send({ type: 'start' })
  interpreter.send({ type: 'next' })
  expect(signal?.aborted).toBe(false)
  interpreter.send({ type: 'cancel' })
  expect(signal?.aborted).toBe(true)
  expect(interpreter.getState().status).toBe('cancelled')
  expect(interpreter.log().filter((event) => event.type === 'transition.failed')).toMatchObject([
    { error: { code: 'CANCELLED', message: 'navigation cancelled' } },
  ])
  expect(interpreter.log().filter((event) => event.type === 'step.guardEvaluated')).toEqual([])
  interpreter.dispose()
})
