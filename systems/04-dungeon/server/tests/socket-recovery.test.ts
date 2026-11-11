import type { DurableStore } from '@openwizard/durable/store'
import {
  type AckSuccessFrame,
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
  type PartyRegistry,
  type RegistryScheduler,
  RUNTIME_UNAVAILABLE_CLOSE_CODE,
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

const openPeer = async (url: string) => {
  const socket = new WebSocket(url)
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
    'initial socket snapshot timed out',
  )
  return { socket, frames }
}

type RecoveryPeer = Awaited<ReturnType<typeof openPeer>>

const closeCode = (peer: RecoveryPeer): Promise<number> =>
  new Promise((resolve) => peer.socket.once('close', (code) => resolve(code)))

const ackFor = async (peer: RecoveryPeer, commandId: string): Promise<AckSuccessFrame> =>
  waitFor(
    () =>
      peer.frames.find(
        (frame): frame is AckSuccessFrame =>
          frame.type === 'ack' && frame.ok && frame.commandId === commandId,
      ),
    `ack ${commandId} timed out`,
  )

const recoverRuntime = async (registry: PartyRegistry, partyId: string) => {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const opened = await registry.get(partyId)
    if (opened.ok) return opened.runtime
    if (opened.code !== 'BUSY') throw new Error(`party recovery failed: ${opened.code}`)
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('party recovery timed out')
}

describe('socket recovery after receipt failure', () => {
  it('closes every bound socket and reconnects to the repaired runtime', async () => {
    const repository = createMemoryPartyRepository()
    let failCompletion = false
    const store: DurableStore = {
      ...repository.store,
      async commit(input) {
        if (failCompletion && input.completeDedupe !== undefined) {
          failCompletion = false
          throw new Error('simulated command receipt completion failure')
        }
        return repository.store.commit(input)
      },
    }
    const registry = createPartyRegistry({
      store,
      directory: repository.directory,
      ownerId: 'socket-recovery-registry',
      scheduler: quietScheduler,
    })
    const server = createDungeonServer({
      registry,
      tokenSecret: 'socket-recovery-secret',
      seedKey: 'socket-recovery-seed',
      port: 0,
    })
    running.push(server)
    const address = await server.start()
    const partyId = 'socket-recovery-party'
    const playerId = 'socket-recovery-player'
    const seeded = await registry.seed({
      partyId,
      seed: 42,
      players: [
        { id: playerId, name: 'Ada' },
        { id: 'socket-recovery-teammate', name: 'Lin' },
      ],
    })
    if (!seeded.ok) throw new Error('party did not seed')
    const token = signPlayerToken('socket-recovery-secret', { partyId, playerId })
    const socketUrl = `${address.url.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`
    const active = await openPeer(socketUrl)
    const passive = await openPeer(socketUrl)
    const activeClosed = closeCode(active)
    const passiveClosed = closeCode(passive)
    const commandA = {
      type: 'command' as const,
      partyId,
      commandId: 'applied-before-socket-restart',
      command: { type: 'ready' as const, ready: true },
    }
    failCompletion = true
    active.socket.send(JSON.stringify(commandA))

    await expect(activeClosed).resolves.toBe(RUNTIME_UNAVAILABLE_CLOSE_CODE)
    await expect(passiveClosed).resolves.toBe(RUNTIME_UNAVAILABLE_CLOSE_CODE)
    expect(seeded.runtime.state().players[playerId]?.ready).toBe(true)

    const repaired = await recoverRuntime(registry, partyId)
    expect(repaired).not.toBe(seeded.runtime)
    const reconnected = await openPeer(socketUrl)
    const beforeReplay = repaired.sequence()
    reconnected.socket.send(JSON.stringify(commandA))
    const replay = await ackFor(reconnected, commandA.commandId)
    expect(replay).toMatchObject({ ok: true, replayed: true, sequence: beforeReplay })
    expect(repaired.sequence()).toBe(beforeReplay)
    expect(repaired.state().players[playerId]?.ready).toBe(true)

    const commandB = {
      type: 'command' as const,
      partyId,
      commandId: 'after-socket-repair',
      command: { type: 'ready' as const, ready: false },
    }
    reconnected.socket.send(JSON.stringify(commandB))
    const applied = await ackFor(reconnected, commandB.commandId)
    expect(applied).toMatchObject({ ok: true, replayed: false })
    expect(repaired.sequence()).toBeGreaterThan(beforeReplay)
    expect(repaired.state().players[playerId]?.ready).toBe(false)
    reconnected.socket.close()
  })
})
