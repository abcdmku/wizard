import { createMemoryDurableStore } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import type { Viewer } from '@wizard/dungeon-shared'
import { describe, expect, it } from 'vitest'
import { createPartyRuntime, resumePartyRuntime } from '../src/index.js'

const isReadySnapshot = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null || !('state' in value)) return false
  const state = value.state
  if (typeof state !== 'object' || state === null || !('context' in state)) return false
  const context = state.context
  if (typeof context !== 'object' || context === null || !('world' in context)) return false
  const world = context.world
  return typeof world === 'object' && world !== null && 'phase' in world && world.phase === 'ready'
}

describe('phase recovery after a committed world update', () => {
  it('reopens the committed phase and repairs its receipt after the owner stops', async () => {
    const base = createMemoryDurableStore()
    let stopAtReady = false
    let stopped = false
    let interruptedNavigation: unknown
    const store: DurableStore = {
      ...base,
      async commit(input) {
        const committed = await base.commit(input)
        if (committed.ok && stopAtReady && isReadySnapshot(input.next?.value)) {
          stopAtReady = false
          stopped = true
          const saved = input.next?.value
          if (typeof saved === 'object' && saved !== null && 'state' in saved) {
            const state = saved.state
            if (typeof state === 'object' && state !== null && 'nav' in state) {
              interruptedNavigation = state.nav
            }
          }
          // Simulate a worker stopping immediately after the first write of the
          // changed phase, before any follow-up routing or receipt completion.
          await base.release(input.lease)
        }
        return committed
      },
    }
    const partyId = 'phase-recovery-party'
    const players = [
      { id: 'player-one', name: 'Ada' },
      { id: 'player-two', name: 'Lin' },
    ]
    const viewer = (playerId: string): Viewer => ({
      tenantId: partyId,
      partyId,
      playerId,
      sessionId: `session:${playerId}`,
    })
    const opened = await createPartyRuntime({
      partyId,
      store,
      ownerId: 'phase-owner-a',
      seed: 42,
      players,
    })
    if (!opened.ok) throw new Error('party did not open')
    for (const player of players) await opened.runtime.connect(player.id)
    expect(
      await opened.runtime.command(viewer('player-one'), {
        commandId: 'first-ready',
        command: { type: 'ready', ready: true },
      }),
    ).toMatchObject({ result: { ok: true } })
    expect(opened.runtime.state().players['player-one']?.ready).toBe(true)
    const input = {
      commandId: 'phase-changing-ready',
      command: { type: 'ready' as const, ready: true },
    }
    stopAtReady = true
    await opened.runtime.command(viewer('player-two'), input)
    expect(stopped).toBe(true)
    await opened.runtime.dispose()

    const resumed = await resumePartyRuntime({ partyId, store: base, ownerId: 'phase-owner-b' })
    expect(resumed.ok, JSON.stringify(interruptedNavigation)).toBe(true)
    if (!resumed.ok) throw new Error(`party did not recover: ${resumed.code}`)
    expect(resumed.runtime.state().phase).toBe('ready')
    expect(resumed.runtime.host.run.waitingFor()).toContainEqual({
      kind: 'event',
      path: [],
      step: 'ready',
      events: [
        'world.tick',
        'player.command',
        'player.connected',
        'player.disconnected',
        'admin.reset',
      ],
    })
    const beforeReplay = resumed.runtime.sequence()
    expect(await resumed.runtime.command(viewer('player-two'), input)).toMatchObject({
      result: { ok: true },
      replayed: true,
    })
    expect(resumed.runtime.sequence()).toBe(beforeReplay)
    await resumed.runtime.dispose()
  })
})
