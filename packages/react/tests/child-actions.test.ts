import { describe, expect, it } from 'vitest'
import type { RawActions } from '../src/adapter'
import { childActions } from '../src/child-actions'

describe('scoped child actions', () => {
  it('preserves the child path, start commands, event identity, and retry patch', async () => {
    const commands: unknown[] = []
    const result = { ok: true, seq: 7 }
    const root: RawActions = {
      next: async () => result,
      back: async () => result,
      go: async () => result,
      setInput: async () => result,
      resetInput: async () => result,
      dispatch: async (command) => {
        commands.push(command)
        return result
      },
    }
    const child = childActions(root, ['fulfil']).child('pack')
    expect(await child.startStep('reserve')).toBe(result)
    expect(await child.startReady()).toBe(result)
    expect(
      await child.send(
        'stock.reserved',
        { reservationId: 'r1' },
        {
          eventId: 'delivery-1',
          correlationId: 'order-1',
        },
      ),
    ).toBe(result)
    expect(await child.retry('reserve', { patch: { warehouse: 'east' } })).toBe(result)
    expect(commands).toEqual([
      {
        type: 'child',
        path: ['fulfil', 'pack'],
        command: { type: 'startStep', step: 'reserve' },
      },
      { type: 'child', path: ['fulfil', 'pack'], command: { type: 'startReady' } },
      {
        type: 'child',
        path: ['fulfil', 'pack'],
        command: {
          type: 'send',
          event: 'stock.reserved',
          payload: { reservationId: 'r1' },
          eventId: 'delivery-1',
          correlationId: 'order-1',
        },
      },
      {
        type: 'child',
        path: ['fulfil', 'pack'],
        command: { type: 'retry', step: 'reserve', patch: { warehouse: 'east' } },
      },
    ])
    expect(childActions(root, ['fulfil']).child('pack')).toBe(child)
  })
})
