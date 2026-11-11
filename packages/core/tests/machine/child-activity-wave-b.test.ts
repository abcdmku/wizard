import { describe, expect, it } from 'vitest'
import { eachChildAddress } from '../../src/machine/child-address'
import { phase } from '../../src/machine/selectors'
import { createHarness, flow, flowStep, replay, runStep } from '../helpers/fixtures'

function mappedChildren() {
  const child = flow({ start: 'work', steps: { work: runStep() } })
  const h = createHarness(
    flow({
      start: 'items',
      steps: {
        items: {
          ...flowStep(child, {
            each: {
              items: () => [0, 1, 2],
              key: (_, index) => ['alpha', 'two', '0'][index] ?? '',
              concurrency: 3,
            },
          }),
          retry: { retries: 1, backoff: 100 },
        },
      },
    }),
  )
  h.start()
  h.ok(h.call('each'), { items: [0, 1, 2], keys: ['alpha', 'two', '0'] })
  for (const call of h.pending('childContext')) h.ok(call, {})
  expect(h.state.failure).toBeUndefined()
  return h
}

describe('mapped child activity', () => {
  it('waits when only parked children remain and ignores completed siblings', () => {
    const h = mappedChildren()
    h.child(
      'items',
      { status: 'done' },
      {
        done: { output: 'first' },
        token: { step: 'items', runId: 1, attempt: 1, itemIndex: 0 },
      },
    )
    h.child(
      'items',
      { status: 'waiting' },
      {
        token: { step: 'items', runId: 1, attempt: 1, itemIndex: 1 },
      },
    )
    expect(h.state.status).toBe('running')
    h.child(
      'items',
      { status: 'waiting' },
      {
        token: { step: 'items', runId: 1, attempt: 1, itemIndex: 2 },
      },
    )
    expect(h.state.status).toBe('waiting')
    expect(phase(h.def, h.state, 'items')).toBe('waiting')
    expect(h.rec('items').each).toMatchObject({ running: 2, done: 1, childWaiting: 2 })
    expect(replay(h)).toEqual(h.state)
    h.child(
      'items',
      { status: 'running', seq: 2 },
      {
        token: { step: 'items', runId: 1, attempt: 1, itemIndex: 1 },
      },
    )
    expect(h.state.status).toBe('running')
    expect(phase(h.def, h.state, 'items')).toBe('running')
  })

  it('keeps retry backoff running while siblings wait for external events', () => {
    const h = mappedChildren()
    for (const itemIndex of [0, 1])
      h.child(
        'items',
        { status: 'waiting' },
        {
          token: { step: 'items', runId: 1, attempt: 1, itemIndex },
        },
      )
    h.child(
      'items',
      { status: 'halted' },
      {
        failed: { error: { name: 'Error', message: 'retry child' } },
        token: { step: 'items', runId: 1, attempt: 1, itemIndex: 2 },
      },
    )
    expect(h.state.status).toBe('running')
    expect(h.rec('items').each).toMatchObject({
      running: 2,
      childWaiting: 2,
      childHalted: 0,
      retrying: 1,
    })
    h.fire('each-retry:items:2')
    expect(h.state.status).toBe('running')
    h.ok(h.call('childContext', 'items'), {})
    h.child(
      'items',
      { status: 'waiting' },
      {
        token: { step: 'items', runId: 1, attempt: 2, itemIndex: 2 },
      },
    )
    expect(h.state.status).toBe('waiting')
    expect(replay(h)).toEqual(h.state)
  })

  it('addresses one mapped child by an index path or a stable nonnumeric key', () => {
    const h = mappedChildren()
    for (const itemIndex of [0, 1, 2])
      h.child(
        'items',
        { status: 'waiting' },
        {
          token: { step: 'items', runId: 1, attempt: 1, itemIndex },
        },
      )
    const byIndex = h.cmd({ type: 'child', path: ['items', '0'], command: { type: 'next' } })
    expect(byIndex.effects).toContainEqual({
      kind: 'child.send',
      step: eachChildAddress('items', 0, 'alpha'),
      command: { type: 'next' },
    })
    const byKey = h.cmd({
      type: 'child',
      path: ['items', 'two', 'nested'],
      command: { type: 'cancel' },
    })
    expect(byKey.effects).toContainEqual({
      kind: 'child.send',
      step: eachChildAddress('items', 1, 'two'),
      command: { type: 'child', path: ['nested'], command: { type: 'cancel' } },
    })
    for (const path of [['items'], ['items', 'missing'], ['items', '99']]) {
      const invalid = h.cmd({ type: 'child', path, command: { type: 'next' } })
      expect(invalid.events).toContainEqual(
        expect.objectContaining({ type: 'command.rejected', code: 'INVALID_COMMAND' }),
      )
      expect(invalid.effects.some((effect) => effect.kind === 'child.send')).toBe(false)
    }
  })
})
