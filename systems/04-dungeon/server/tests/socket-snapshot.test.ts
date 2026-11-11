import {
  type ErrorFrame,
  type ServerFrame,
  ServerFrameSchema,
  type SnapshotFrame,
} from '@wizard/dungeon-shared'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  createDungeonServer,
  createMemoryPartyRepository,
  createPartyRegistry,
  type DungeonServer,
  type RegistryScheduler,
  signPlayerToken,
} from '../src/index.js'

const quietScheduler: RegistryScheduler = {
  setInterval: (callback) => setTimeout(callback, 60_000),
  clearInterval: (handle) => clearTimeout(handle),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
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

describe('socket snapshot requests', () => {
  it('keeps streaming ticks after snapshot, malformed, and foreign-party messages', async () => {
    const repository = createMemoryPartyRepository()
    const registry = createPartyRegistry({
      store: repository.store,
      directory: repository.directory,
      ownerId: 'snapshot-request-test',
      scheduler: quietScheduler,
    })
    const server = createDungeonServer({
      registry,
      tokenSecret: 'snapshot-request-secret',
      seedKey: 'snapshot-request-seed',
      port: 0,
    })
    running.push(server)
    const address = await server.start()
    const partyId = 'snapshot-request-party'
    const seeded = await registry.seed({
      partyId,
      seed: 42,
      players: [
        { id: 'player-one', name: 'Ada' },
        { id: 'player-two', name: 'Lin' },
      ],
    })
    if (!seeded.ok) throw new Error('snapshot request party did not seed')

    const token = signPlayerToken('snapshot-request-secret', {
      partyId,
      playerId: 'player-one',
    })
    const socket = new WebSocket(
      `${address.url.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`,
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

    const responseStart = frames.length
    socket.send(JSON.stringify({ type: 'request-snapshot', partyId }))
    socket.send('{')
    socket.send(JSON.stringify({ type: 'request-snapshot', partyId: 'foreign-party' }))
    const errors = await waitFor(() => {
      const received = frames
        .slice(responseStart)
        .filter((frame): frame is ErrorFrame => frame.type === 'error')
      return received.length >= 2 ? received : undefined
    }, 'snapshot request rejections timed out')
    expect(errors.map((frame) => frame.error.code)).toEqual(['invalid-command', 'forbidden'])
    const requested = frames
      .slice(responseStart)
      .find((frame): frame is SnapshotFrame => frame.type === 'snapshot')
    if (requested === undefined) throw new Error('request-snapshot did not return a snapshot')

    const tickBefore = requested.tick
    const streamStart = frames.length
    await registry.tickAll()
    await registry.tickAll()
    await registry.tickAll()
    const streamed = await waitFor(() => {
      const snapshots = frames
        .slice(streamStart)
        .filter(
          (frame): frame is SnapshotFrame => frame.type === 'snapshot' && frame.tick > tickBefore,
        )
        .filter(
          (frame, index, all) =>
            all.findIndex((candidate) => candidate.tick === frame.tick) === index,
        )
      return snapshots.length >= 3 ? snapshots : undefined
    }, 'tick snapshots stopped after request-snapshot')
    expect(streamed).toHaveLength(3)
    for (let index = 1; index < streamed.length; index += 1) {
      const previous = streamed[index - 1]
      const current = streamed[index]
      if (previous === undefined || current === undefined) throw new Error('snapshot missing')
      expect(current.tick).toBeGreaterThan(previous.tick)
      expect(current.sequence).toBeGreaterThan(previous.sequence)
    }
    socket.close()
  })
})
