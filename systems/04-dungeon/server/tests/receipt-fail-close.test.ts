import { createMemoryDurableStore } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import type { Viewer } from '@wizard/dungeon-shared'
import { describe, expect, it } from 'vitest'
import { createPartyRuntime, resumePartyRuntime } from '../src/index.js'

const PARTY_ID = 'fail-close-party'
const PLAYER_ID = 'fail-close-player'
const viewer: Viewer = {
  tenantId: PARTY_ID,
  partyId: PARTY_ID,
  playerId: PLAYER_ID,
  sessionId: 'fail-close-session',
}

describe('command receipt failure gate', () => {
  it('closes admission when an older owner applied a command without its result', async () => {
    const base = createMemoryDurableStore()
    const store: DurableStore = {
      ...base,
      async claimDedupe(input) {
        if (input.id.endsWith(':interrupted-command')) return { ok: true, status: 'applied' }
        return base.claimDedupe(input)
      },
    }
    const opened = await createPartyRuntime({
      partyId: PARTY_ID,
      store,
      ownerId: 'applied-receipt-owner',
      seed: 42,
      players: [
        { id: PLAYER_ID, name: 'Ada' },
        { id: 'fail-close-teammate', name: 'Lin' },
      ],
    })
    if (!opened.ok) throw new Error('party did not open')
    const runtime = opened.runtime
    const before = runtime.sequence()
    const ack = await runtime.command(viewer, {
      commandId: 'interrupted-command',
      command: { type: 'ready', ready: true },
    })
    expect(ack).toMatchObject({
      result: { ok: false, code: 'INTERNAL' },
      replayed: false,
      sequence: before,
    })
    expect(runtime.state().players[PLAYER_ID]?.ready).toBe(false)
    await expect(runtime.tick()).rejects.toThrow('party runtime is disposed')
    await runtime.dispose()
  })

  it('rejects already-queued mutations before takeover repairs the applied command', async () => {
    const base = createMemoryDurableStore()
    let failCompletion = false
    let markCompletionStarted = (): void => undefined
    let releaseCompletion = (): void => undefined
    const completionStarted = new Promise<void>((resolve) => {
      markCompletionStarted = resolve
    })
    const completionReleased = new Promise<void>((resolve) => {
      releaseCompletion = resolve
    })
    const store: DurableStore = {
      ...base,
      async commit(input) {
        if (failCompletion && input.completeDedupe !== undefined) {
          markCompletionStarted()
          await completionReleased
          failCompletion = false
          throw new Error('simulated receipt completion crash')
        }
        return base.commit(input)
      },
    }
    const opened = await createPartyRuntime({
      partyId: PARTY_ID,
      store,
      ownerId: 'fail-close-owner-a',
      seed: 42,
      players: [
        { id: PLAYER_ID, name: 'Ada' },
        { id: 'fail-close-teammate', name: 'Lin' },
      ],
    })
    if (!opened.ok) throw new Error('party did not open')
    const runtime = opened.runtime
    await runtime.connect(PLAYER_ID)
    const input = {
      commandId: 'applied-before-completion-crash',
      command: { type: 'ready' as const, ready: true },
    }
    failCompletion = true
    const first = runtime.command(viewer, input)
    await completionStarted
    const queuedCommand = runtime.command(viewer, {
      commandId: 'queued-behind-failed-completion',
      command: { type: 'ready', ready: false },
    })
    const queuedTick = runtime.tick()
    releaseCompletion()

    await expect(first).resolves.toMatchObject({ result: { ok: false, code: 'INTERNAL' } })
    await expect(queuedCommand).rejects.toThrow('party runtime is disposed')
    await expect(queuedTick).rejects.toThrow('party runtime is disposed')
    expect(runtime.state().players[PLAYER_ID]?.ready).toBe(true)
    const appliedSequence = runtime.sequence()
    const appliedTick = runtime.state().tick
    expect(runtime.host.run.getState().context.lastCommandReceipt?.key).toContain(input.commandId)
    await base.release(runtime.host.lease)
    await runtime.dispose()

    const resumed = await resumePartyRuntime({
      partyId: PARTY_ID,
      store: base,
      ownerId: 'fail-close-owner-b',
    })
    if (!resumed.ok) throw new Error('party did not resume')
    expect(resumed.runtime.state().players[PLAYER_ID]?.ready).toBe(true)
    expect(resumed.runtime.state().tick).toBe(appliedTick)
    const beforeReplay = resumed.runtime.sequence()
    expect(beforeReplay).toBeGreaterThanOrEqual(appliedSequence)
    expect(await resumed.runtime.command(viewer, input)).toMatchObject({
      result: { ok: true },
      replayed: true,
    })
    expect(resumed.runtime.sequence()).toBe(beforeReplay)
    await resumed.runtime.dispose()
  })

  it('closes after a reclaimed singleton receipt cannot complete', async () => {
    const base = createMemoryDurableStore({
      retention: { completedDedupeMs: 0, timerClaimMs: 60_000 },
    })
    let failCompletion = false
    let markCompletionStarted = (): void => undefined
    let releaseCompletion = (): void => undefined
    const completionStarted = new Promise<void>((resolve) => {
      markCompletionStarted = resolve
    })
    const completionReleased = new Promise<void>((resolve) => {
      releaseCompletion = resolve
    })
    const store: DurableStore = {
      ...base,
      async commit(input) {
        if (failCompletion && input.completeDedupe !== undefined) {
          failCompletion = false
          markCompletionStarted()
          await completionReleased
          throw new Error('simulated reclaimed completion crash')
        }
        return base.commit(input)
      },
    }
    const opened = await createPartyRuntime({
      partyId: PARTY_ID,
      store,
      ownerId: 'reclaimed-owner-a',
      seed: 42,
      players: [
        { id: PLAYER_ID, name: 'Ada' },
        { id: 'fail-close-teammate', name: 'Lin' },
      ],
    })
    if (!opened.ok) throw new Error('party did not open')
    const runtime = opened.runtime
    await runtime.connect(PLAYER_ID)
    const firstInput = {
      commandId: 'reclaimed-a',
      command: { type: 'ready' as const, ready: true },
    }
    expect(await runtime.command(viewer, firstInput)).toMatchObject({ result: { ok: true } })
    expect((await base.sweep()).dedupeRemoved).toBeGreaterThanOrEqual(1)

    failCompletion = true
    const duplicate = runtime.command(viewer, firstInput)
    await completionStarted
    const queuedInput = {
      commandId: 'queued-b',
      command: { type: 'ready' as const, ready: false },
    }
    const queuedCommand = runtime.command(viewer, queuedInput)
    const tickBefore = runtime.state().tick
    const queuedTick = runtime.tick()
    releaseCompletion()
    await expect(duplicate).resolves.toMatchObject({ result: { ok: false, code: 'INTERNAL' } })
    await expect(queuedCommand).rejects.toThrow('party runtime is disposed')
    await expect(queuedTick).rejects.toThrow('party runtime is disposed')
    expect(runtime.state().players[PLAYER_ID]?.ready).toBe(true)
    expect(runtime.state().tick).toBe(tickBefore)
    await base.release(runtime.host.lease)
    await runtime.dispose()

    const resumed = await resumePartyRuntime({
      partyId: PARTY_ID,
      store: base,
      ownerId: 'reclaimed-owner-b',
    })
    if (!resumed.ok) throw new Error('party did not resume')
    const beforeReplay = resumed.runtime.sequence()
    expect(await resumed.runtime.command(viewer, firstInput)).toMatchObject({
      result: { ok: true },
      replayed: true,
    })
    expect(resumed.runtime.sequence()).toBe(beforeReplay)
    expect(await resumed.runtime.command(viewer, queuedInput)).toMatchObject({
      result: { ok: true },
      replayed: false,
    })
    expect(resumed.runtime.state().players[PLAYER_ID]?.ready).toBe(false)
    await resumed.runtime.dispose()
  })
})
