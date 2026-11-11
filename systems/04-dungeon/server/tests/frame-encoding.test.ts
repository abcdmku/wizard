import { MAX_SERVER_FRAME_BYTES, type ServerFrame, ServerFrameSchema } from '@wizard/dungeon-shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import {
  createDungeonServer,
  createMemoryPartyRepository,
  createPartyRegistry,
  type DungeonServer,
  encodeServerFrame,
  isEncodedServerFrameWithinLimit,
  signPlayerToken,
} from '../src/index.js'

interface Measurement {
  readonly bytes: number
  readonly frame: ServerFrame
}

const running: DungeonServer[] = []

afterEach(async () => {
  vi.restoreAllMocks()
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

const startServer = async (measurements: Measurement[]) => {
  const repository = createMemoryPartyRepository()
  const registry = createPartyRegistry({
    store: repository.store,
    directory: repository.directory,
    ownerId: 'frame-encoding-test',
  })
  const server = createDungeonServer({
    registry,
    tokenSecret: 'frame-encoding-secret',
    seedKey: 'frame-encoding-seed',
    port: 0,
    onFrame: (measurement) => measurements.push(measurement),
  })
  running.push(server)
  return { address: await server.start(), registry }
}

const openSocket = async (
  url: string,
  token: string,
  onMessage: (payload: string) => void,
): Promise<WebSocket> => {
  const socket = new WebSocket(
    `${url.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`,
  )
  socket.on('message', (raw) => onMessage(raw.toString()))
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

describe('server frame encoding', () => {
  it('stringifies once and measures the UTF-8 payload used by the limit gate', () => {
    const frame: ServerFrame = {
      type: 'error',
      protocolVersion: 1,
      partyId: 'party-猫',
      sequence: 4,
      tick: 2,
      commandId: null,
      error: { code: 'server-error', message: '龍 escaped the vault', retryable: false },
    }
    const expected = JSON.stringify(frame)
    const stringify = vi.spyOn(JSON, 'stringify')
    const encoded = encodeServerFrame(frame)

    expect(stringify).toHaveBeenCalledTimes(1)
    expect(encoded.payload).toBe(expected)
    expect(encoded.bytes).toBe(Buffer.byteLength(expected, 'utf8'))
    expect(encoded.bytes).toBeGreaterThan(expected.length)
    expect(isEncodedServerFrameWithinLimit({ ...encoded, bytes: MAX_SERVER_FRAME_BYTES })).toBe(
      true,
    )
    expect(isEncodedServerFrameWithinLimit({ ...encoded, bytes: MAX_SERVER_FRAME_BYTES + 1 })).toBe(
      false,
    )
  })

  it('sends the exact measured multibyte payload', async () => {
    const measurements: Measurement[] = []
    const { address, registry } = await startServer(measurements)
    const partyId = 'multibyte-frame-party'
    const seeded = await registry.seed({
      partyId,
      seed: 42,
      players: [
        { id: 'player-one', name: '猫🐉' },
        { id: 'player-two', name: 'Lin' },
      ],
    })
    if (!seeded.ok) throw new Error('multibyte party did not seed')
    const token = signPlayerToken('frame-encoding-secret', { partyId, playerId: 'player-one' })
    const payloads: string[] = []
    const socket = await openSocket(address.url, token, (payload) => payloads.push(payload))

    const measurement = await waitFor(
      () => measurements.find(({ frame }) => frame.type === 'snapshot'),
      'measured snapshot timed out',
    )
    const payload = await waitFor(
      () =>
        payloads.find((candidate) => {
          const parsed = ServerFrameSchema.safeParse(JSON.parse(candidate))
          return parsed.success && parsed.data.type === 'snapshot'
        }),
      'snapshot payload timed out',
    )
    expect(payload).toBe(JSON.stringify(measurement.frame))
    expect(measurement.bytes).toBe(Buffer.byteLength(payload, 'utf8'))
    expect(measurement.bytes).toBeGreaterThan(payload.length)
    socket.close()
  })

  it('closes before sending a frame over 25000 UTF-8 bytes', async () => {
    const measurements: Measurement[] = []
    const { address, registry } = await startServer(measurements)
    const partyId = 'oversized-frame-party'
    const seeded = await registry.seed({
      partyId,
      seed: 42,
      players: [
        { id: 'player-one', name: 'Ada' },
        { id: 'player-two', name: 'Lin' },
      ],
    })
    if (!seeded.ok) throw new Error('oversized party did not seed')
    const world = seeded.runtime.state()
    world.map.width = 256
    world.map.height = 256
    world.map.rows = Array.from({ length: 256 }, () => '.'.repeat(256))
    const token = signPlayerToken('frame-encoding-secret', { partyId, playerId: 'player-one' })
    const socket = new WebSocket(
      `${address.url.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`,
    )
    const payloads: string[] = []
    socket.on('message', (raw) => payloads.push(raw.toString()))
    const closed = new Promise<number>((resolve, reject) => {
      socket.once('close', resolve)
      socket.once('error', reject)
    })

    await expect(closed).resolves.toBe(1009)
    const oversized = measurements.find(({ frame }) => frame.type === 'snapshot')
    if (oversized === undefined) throw new Error('oversized snapshot was not measured')
    expect(oversized.bytes).toBeGreaterThan(MAX_SERVER_FRAME_BYTES)
    expect(
      payloads.some((payload) => {
        const parsed = ServerFrameSchema.safeParse(JSON.parse(payload))
        return parsed.success && parsed.data.type === 'snapshot'
      }),
    ).toBe(false)
  })
})
