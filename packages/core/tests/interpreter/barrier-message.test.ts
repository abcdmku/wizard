import { expect, it } from 'vitest'
import { createSequentialIds } from '../../src/interpreter/env'
import { createInterpreter } from '../../src/interpreter/interpreter'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { Message } from '../../src/machine/commands'
import { initialState, machine } from '../../src/machine/index'
import { eventStep, flow, runStep, trusted } from '../helpers/fixtures'

it('identifies the queue message that caused each durable barrier batch', () => {
  const def = flow({ start: 'work', steps: { work: runStep({ run: () => 42 }) } })
  const scheduler = createTestScheduler({ now: 100 })
  const ids = createSequentialIds()
  const messages: Message[] = []
  const interpreter = createInterpreter({
    def,
    machine,
    path: [],
    env: { clock: scheduler, scheduler, ids },
    initialState: initialState(
      { def, path: [], now: scheduler.now, id: ids.id },
      { instanceId: 'barrier', context: {}, now: 100 },
    ),
    beforeEffects(_state, _batch, _effects, _children, message) {
      messages.push(message)
    },
  })
  const start: Message = { type: 'start' }
  interpreter.send(start)
  expect(messages[0]).toBe(start)
  expect(messages.map((message) => message.type)).toEqual(['start', 'res.ok', 'settle'])
  expect(messages[1]).toMatchObject({ hook: 'run', value: 42 })
  interpreter.dispose()
})

it('commits a synchronous wait update and completion in one durable batch', () => {
  const def = flow({
    start: 'approval',
    events: { approve: trusted() },
    steps: {
      approval: eventStep({
        on: {
          approve: ({ update }) => {
            update({ phase: 'approved' })
            return { done: 'accepted' }
          },
        },
        next: 'finish',
      }),
      finish: runStep({ run: () => 'done' }),
    },
  })
  const scheduler = createTestScheduler({ now: 100 })
  const ids = createSequentialIds()
  const barriers: Array<{ phase: unknown; wait: string; events: string[] }> = []
  const interpreter = createInterpreter({
    def,
    machine,
    path: [],
    env: { clock: scheduler, scheduler, ids },
    initialState: initialState(
      { def, path: [], now: scheduler.now, id: ids.id },
      { instanceId: 'wait-barrier', context: { phase: 'pending' }, now: 100 },
    ),
    beforeEffects(state, batch) {
      barriers.push({
        phase:
          typeof state.context === 'object' && state.context !== null && 'phase' in state.context
            ? state.context.phase
            : undefined,
        wait: state.steps.approval?.status ?? 'missing',
        events: batch.map((event) => event.type),
      })
    },
  })
  interpreter.send({ type: 'start' })
  interpreter.send({ type: 'send', event: 'approve', payload: {} })
  const updated = barriers.filter((barrier) => barrier.phase === 'approved')
  expect(updated.length).toBeGreaterThan(0)
  expect(updated.every((barrier) => barrier.wait === 'done')).toBe(true)
  expect(updated[0]?.events).toEqual(expect.arrayContaining(['context.changed', 'step.done']))
  expect(interpreter.getState().status).toBe('done')
  interpreter.dispose()
})
