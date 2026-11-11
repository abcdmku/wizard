import { afterEach, describe, expect, it } from 'vitest'
import {
  createMemoryPartyRepository,
  createPartyRegistry,
  type PartyRegistry,
  type RegistryScheduler,
} from '../src/index.js'

const roster = [
  { id: 'player-one', name: 'Ada' },
  { id: 'player-two', name: 'Lin' },
]

const quietScheduler: RegistryScheduler = {
  setInterval: (callback) => setTimeout(callback, 60_000),
  clearInterval: (handle) => clearTimeout(handle),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
}

const openRegistries = new Set<PartyRegistry>()
const track = (registry: PartyRegistry): PartyRegistry => {
  openRegistries.add(registry)
  return registry
}
const stop = async (registry: PartyRegistry): Promise<void> => {
  await registry.stop()
  openRegistries.delete(registry)
}

afterEach(async () => {
  const registries = [...openRegistries]
  openRegistries.clear()
  await Promise.all(registries.map((registry) => registry.stop()))
})

describe('registry tick cadence', () => {
  it('pauses cached and recovered parties until a player connects', async () => {
    const repository = createMemoryPartyRepository()
    const first = track(
      createPartyRegistry({
        store: repository.store,
        directory: repository.directory,
        ownerId: 'idle-registry-a',
        scheduler: quietScheduler,
      }),
    )
    const seeded = await first.seed({ partyId: 'party-one', seed: 42, players: roster })
    if (!seeded.ok) throw new Error('party did not seed')
    const runtime = seeded.runtime
    const idleSequence = runtime.sequence()
    const idleTick = runtime.state().tick
    await first.tickAll()
    expect(runtime.sequence()).toBe(idleSequence)
    expect(runtime.state().tick).toBe(idleTick)

    await runtime.connect('player-one')
    const connectedSequence = runtime.sequence()
    await first.tickAll()
    expect(runtime.sequence()).toBeGreaterThan(connectedSequence)
    expect(runtime.state().tick).toBe(idleTick + 1)
    await stop(first)

    const second = track(
      createPartyRegistry({
        store: repository.store,
        directory: repository.directory,
        ownerId: 'idle-registry-b',
        scheduler: quietScheduler,
      }),
    )
    const recovered = await second.start()
    expect(recovered).toHaveLength(1)
    const resumed = second.cached('party-one')
    if (resumed === undefined) throw new Error('party did not recover')
    expect(resumed.state().players['player-one']?.presence).toBe('connected')
    expect(resumed.hasLivePlayers()).toBe(false)
    const recoveredSequence = resumed.sequence()
    const recoveredTick = resumed.state().tick
    await second.tickAll()
    expect(resumed.sequence()).toBe(recoveredSequence)
    expect(resumed.state().tick).toBe(recoveredTick)

    await resumed.connect('player-one')
    const reconnectedSequence = resumed.sequence()
    await second.tickAll()
    expect(resumed.sequence()).toBeGreaterThan(reconnectedSequence)
    expect(resumed.state().tick).toBe(recoveredTick + 1)

    await resumed.disconnect('player-one')
    const disconnectedSequence = resumed.sequence()
    const disconnectedTick = resumed.state().tick
    await second.tickAll()
    expect(resumed.sequence()).toBe(disconnectedSequence)
    expect(resumed.state().tick).toBe(disconnectedTick)
    await stop(second)
  })
})
