import {
  type AckFrame,
  type ServerFrame,
  ServerFrameSchema,
  type SnapshotFrame,
  type Viewer,
} from '@wizard/dungeon-shared'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  createDungeonServer,
  createMemoryPartyRepository,
  createPartyRegistry,
  type DungeonServer,
  dungeonProjection,
  type RegistryScheduler,
  signPlayerToken,
} from '../src/index.js'

const PARTY_ID = 'command-snapshot-party'
const quietScheduler: RegistryScheduler = {
  setInterval: (callback) => setTimeout(callback, 60_000),
  clearInterval: (handle) => clearTimeout(handle),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
}

interface Peer {
  readonly frames: ServerFrame[]
  readonly socket: WebSocket
}

const running: DungeonServer[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop()))
})

const waitFor = async <Value>(read: () => Value | undefined, message: string): Promise<Value> => {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const value = read()
    if (value !== undefined) return value
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(message)
}

const openPeer = async (url: string, token: string): Promise<Peer> => {
  const socket = new WebSocket(
    `${url.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`,
  )
  const frames: ServerFrame[] = []
  socket.on('message', (raw) => {
    let decoded: unknown
    try {
      decoded = JSON.parse(raw.toString())
    } catch {
      return
    }
    const parsed = ServerFrameSchema.safeParse(decoded)
    if (parsed.success) frames.push(parsed.data)
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  await waitFor(
    () => frames.find((frame): frame is SnapshotFrame => frame.type === 'snapshot'),
    'initial snapshot timed out',
  )
  return { frames, socket }
}

const commandAndFollowingSnapshot = async (
  peer: Peer,
  commandId: string,
  command: unknown,
): Promise<{ readonly ack: AckFrame; readonly snapshot: SnapshotFrame }> => {
  const start = peer.frames.length
  peer.socket.send(JSON.stringify({ type: 'command', partyId: PARTY_ID, commandId, command }))
  const ackIndex = await waitFor(() => {
    const index = peer.frames.findIndex(
      (frame, candidate) =>
        candidate >= start && frame.type === 'ack' && frame.commandId === commandId,
    )
    return index < 0 ? undefined : index
  }, `${commandId} ack timed out`)
  const ack = peer.frames[ackIndex]
  if (ack?.type !== 'ack') throw new Error(`${commandId} ack missing`)
  const following = await waitFor(
    () => peer.frames[ackIndex + 1],
    `${commandId} following snapshot timed out`,
  )
  if (following.type !== 'snapshot') {
    throw new Error(`${commandId} was followed by ${following.type}, not a snapshot`)
  }
  return { ack, snapshot: following }
}

const viewer = (playerId: string): Viewer => ({
  tenantId: PARTY_ID,
  partyId: PARTY_ID,
  playerId,
  sessionId: `session:${playerId}`,
})

describe('command snapshot correlation', () => {
  it('follows phase and movement ACKs with the exact settled snapshot', async () => {
    const repository = createMemoryPartyRepository()
    const registry = createPartyRegistry({
      store: repository.store,
      directory: repository.directory,
      ownerId: 'command-snapshot-test',
      scheduler: quietScheduler,
    })
    const server = createDungeonServer({
      registry,
      tokenSecret: 'command-snapshot-secret',
      seedKey: 'command-snapshot-seed',
      port: 0,
    })
    running.push(server)
    const address = await server.start()
    const seeded = await registry.seed({
      partyId: PARTY_ID,
      seed: 42,
      players: [
        { id: 'player-one', name: 'Ada' },
        { id: 'player-two', name: 'Lin' },
      ],
    })
    if (!seeded.ok) throw new Error('command snapshot party did not seed')
    const first = await openPeer(
      address.url,
      signPlayerToken('command-snapshot-secret', { partyId: PARTY_ID, playerId: 'player-one' }),
    )
    const second = await openPeer(
      address.url,
      signPlayerToken('command-snapshot-secret', { partyId: PARTY_ID, playerId: 'player-two' }),
    )

    await commandAndFollowingSnapshot(first, 'ready-one', { type: 'ready', ready: true })
    const phase = await commandAndFollowingSnapshot(second, 'ready-two', {
      type: 'ready',
      ready: true,
    })
    expect(phase.ack.ok).toBe(true)
    expect(phase.snapshot.sequence).toBe(phase.ack.sequence)
    expect(phase.snapshot.epoch).toBe(seeded.runtime.host.run.epoch)
    expect(phase.snapshot.tick).toBe(phase.ack.tick)
    expect(phase.snapshot.projection.sequence).toBe(phase.ack.sequence)
    expect(phase.snapshot.projection.phase).toBe('ready')
    expect(phase.snapshot.projection).toEqual(
      seeded.runtime.host.run.project(dungeonProjection, viewer('player-two')),
    )

    await registry.tickAll()
    await registry.tickAll()
    expect(seeded.runtime.state().phase).toBe('exploration')
    const movement = await commandAndFollowingSnapshot(first, 'move-west', {
      type: 'move',
      direction: 'west',
    })
    expect(movement.ack.ok).toBe(true)
    expect(movement.snapshot.sequence).toBe(movement.ack.sequence)
    expect(movement.snapshot.epoch).toBe(seeded.runtime.host.run.epoch)
    expect(movement.snapshot.tick).toBe(movement.ack.tick)
    expect(movement.snapshot.projection.sequence).toBe(movement.ack.sequence)
    expect(movement.snapshot.projection.self.facing).toBe('west')
    expect(movement.snapshot.projection).toEqual(
      seeded.runtime.host.run.project(dungeonProjection, viewer('player-one')),
    )

    const resetStart = first.frames.length
    await seeded.runtime.reset(84, 'snapshot-watermark-reset')
    const reset = await waitFor(
      () =>
        first.frames
          .slice(resetStart)
          .find(
            (frame): frame is SnapshotFrame =>
              frame.type === 'snapshot' && frame.tick === 0 && frame.projection.phase === 'lobby',
          ),
      'reset snapshot timed out',
    )
    expect(reset.epoch).toBe(seeded.runtime.host.run.epoch)
    const malformedStart = first.frames.length
    first.socket.send('{')
    await waitFor(
      () => first.frames.slice(malformedStart).find((frame) => frame.type === 'error'),
      'malformed message error timed out',
    )
    const requestStart = first.frames.length
    first.socket.send(JSON.stringify({ type: 'request-snapshot', partyId: PARTY_ID }))
    const requested = await waitFor(
      () =>
        first.frames
          .slice(requestStart)
          .find((frame): frame is SnapshotFrame => frame.type === 'snapshot'),
      'requested reset snapshot timed out',
    )
    expect(requested.sequence).toBe(seeded.runtime.sequence())
    expect(requested.epoch).toBe(seeded.runtime.host.run.epoch)
    expect(requested.projection).toEqual(
      seeded.runtime.host.run.project(dungeonProjection, viewer('player-one')),
    )
    const afterReset = await commandAndFollowingSnapshot(first, 'ready-after-reset', {
      type: 'ready',
      ready: true,
    })
    expect(afterReset.snapshot.sequence).toBe(afterReset.ack.sequence)
    expect(afterReset.snapshot.epoch).toBe(requested.epoch)
    expect(afterReset.snapshot.projection.self.ready).toBe(true)
    first.socket.close()
    second.socket.close()
  })
})
