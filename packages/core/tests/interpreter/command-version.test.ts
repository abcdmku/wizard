import { expect, it } from 'vitest'
import { createSequentialIds } from '../../src/interpreter/env'
import { createInterpreter } from '../../src/interpreter/interpreter'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { initialState } from '../../src/machine/index'
import { flow, view } from '../helpers/fixtures'

it('checks optimistic versions after the preceding host barrier commits', async () => {
  const def = flow({ start: 'form', steps: { form: view() } })
  const scheduler = createTestScheduler({ now: 100 })
  const ids = createSequentialIds()
  let block = false
  let release: () => void = () => {}
  const interpreter = createInterpreter({
    def,
    path: [],
    env: { clock: scheduler, scheduler, ids },
    initialState: initialState(
      { def, path: [], now: scheduler.now, id: ids.id },
      { instanceId: 'version', context: {}, now: 100 },
    ),
    beforeEffects(_state, _batch, _effects, _children, message) {
      if (!block || message.type !== 'setInput') return
      block = false
      return new Promise<void>((resolve) => {
        release = resolve
      })
    },
  })
  interpreter.send({ type: 'start' })
  const current = interpreter.getState()
  const expectedVersion = { epoch: current.epoch, seq: current.seq }
  block = true
  interpreter.send({ type: 'setInput', step: 'form', patch: { first: 1 } })
  interpreter.send(
    { type: 'setInput', step: 'form', patch: { stale: 2 } },
    undefined,
    expectedVersion,
  )
  expect(interpreter.getState().steps.form?.input).toBeUndefined()
  release()
  await interpreter.whenIdle()
  expect(interpreter.getState().steps.form?.input).toEqual({ first: 1 })
  expect(interpreter.log().filter((event) => event.type === 'command.rejected')).toMatchObject([
    { code: 'STALE', reason: 'stale-version', command: { type: 'setInput', patch: { stale: 2 } } },
  ])
  const state = interpreter.getState()
  interpreter.send({ type: 'setInput', step: 'form', patch: { fresh: 3 } }, undefined, {
    epoch: state.epoch,
    seq: state.seq,
  })
  expect(interpreter.getState().steps.form?.input).toEqual({ first: 1, fresh: 3 })
  interpreter.dispose()
})
