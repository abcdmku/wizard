import type { DurableStore } from '@openwizard/durable/store'
import {
  type ServerFrame,
  ServerFrameSchema,
  type SnapshotFrame,
  type Viewer,
} from '@wizard/dungeon-shared'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  commandResultKey,
  createDungeonServer,
  createMemoryPartyRepository,
  createPartyRegistry,
  type DungeonServer,
  dungeonProjection,
  type RegistryScheduler,
  type RuntimeCommand,
  signPlayerToken,
} from '../src/index.js'

const PARTY_ID = 'tick-forwarding-party'
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

const deferred = () => {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const waitFor = async <Value>(read: () => Value | undefined, message: string): Promise<Value> => {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const value = read()
    if (value !== undefined) return value
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(message)
}

const openSocket = async (url: string, token: string) => {
  const frames: ServerFrame[] = []
  const socket = new WebSocket(
    `${url.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`,
  )
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

const viewer = (playerId: string): Viewer => ({
  tenantId: PARTY_ID,
  partyId: PARTY_ID,
  playerId,
  sessionId: `session:${playerId}`,
})

const wireCommand = (commandId: string, command: RuntimeCommand['command']): string =>
  JSON.stringify({ type: 'command', partyId: PARTY_ID, commandId, command })

describe('tick forwarding during command suppression', () => {
  it('forwards queued ticks before the ACK and suppresses same-tick command commits', async () => {
    const repository = createMemoryPartyRepository()
    const admittedA = deferred()
    const releaseA = deferred()
    const admittedResetA = deferred()
    const releaseResetA = deferred()
    const pauses = new Map([
      [
        `dungeon-command:${commandResultKey('player-one', 'paused-a')}`,
        { admitted: admittedA, release: releaseA },
      ],
      [
        `dungeon-command:${commandResultKey('player-one', 'paused-reset-a')}`,
        { admitted: admittedResetA, release: releaseResetA },
      ],
    ])
    const store: DurableStore = {
      ...repository.store,
      async claimDedupe(input) {
        const pause = pauses.get(input.id)
        if (pause !== undefined) {
          pauses.delete(input.id)
          pause.admitted.resolve()
          await pause.release.promise
        }
        return repository.store.claimDedupe(input)
      },
    }
    const registry = createPartyRegistry({
      store,
      directory: repository.directory,
      ownerId: 'tick-forwarding-test',
      scheduler: quietScheduler,
    })
    const server = createDungeonServer({
      registry,
      tokenSecret: 'tick-forwarding-secret',
      seedKey: 'tick-forwarding-seed',
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
    if (!seeded.ok) throw new Error('tick forwarding party did not seed')
    const first = await openSocket(
      address.url,
      signPlayerToken('tick-forwarding-secret', { partyId: PARTY_ID, playerId: 'player-one' }),
    )
    const second = await openSocket(
      address.url,
      signPlayerToken('tick-forwarding-secret', { partyId: PARTY_ID, playerId: 'player-two' }),
    )
    await seeded.runtime.command(viewer('player-one'), {
      commandId: 'setup-ready-one',
      command: { type: 'ready', ready: true },
    })
    await seeded.runtime.command(viewer('player-two'), {
      commandId: 'setup-ready-two',
      command: { type: 'ready', ready: true },
    })
    await seeded.runtime.tick()
    await seeded.runtime.tick()
    if (seeded.runtime.state().phase !== 'exploration') {
      throw new Error('tick forwarding party did not reach exploration')
    }
    await waitFor(
      () =>
        second.frames.find(
          (frame): frame is SnapshotFrame =>
            frame.type === 'snapshot' && frame.projection.phase === 'exploration',
        ),
      'exploration snapshot timed out',
    )

    const queuedB = deferred()
    const queuedResetB = deferred()
    const queuedCommands = new Map([
      ['waiting-b', queuedB],
      ['waiting-after-reset', queuedResetB],
    ])
    const runtimeCommand = seeded.runtime.command.bind(seeded.runtime)
    Object.defineProperty(seeded.runtime, 'command', {
      configurable: true,
      value: (currentViewer: Viewer, input: RuntimeCommand) => {
        const pending = runtimeCommand(currentViewer, input)
        queuedCommands.get(input.commandId)?.resolve()
        return pending
      },
    })
    const baselineTick = seeded.runtime.state().tick
    first.socket.send(wireCommand('paused-a', { type: 'move', direction: 'east' }))
    await admittedA.promise
    const tick = seeded.runtime.tick()
    const start = second.frames.length
    second.socket.send(wireCommand('waiting-b', { type: 'move', direction: 'west' }))
    await queuedB.promise
    releaseA.resolve()
    await tick

    const ackIndex = await waitFor(() => {
      const index = second.frames.findIndex(
        (frame, candidate) =>
          candidate >= start && frame.type === 'ack' && frame.commandId === 'waiting-b',
      )
      return index < 0 ? undefined : index
    }, 'waiting command ack timed out')
    const beforeAck = second.frames
      .slice(start, ackIndex)
      .filter((frame): frame is SnapshotFrame => frame.type === 'snapshot')
    expect(beforeAck.length).toBeGreaterThanOrEqual(1)
    let priorTick = baselineTick
    for (const frame of beforeAck) {
      expect(frame.tick).toBeGreaterThan(priorTick)
      priorTick = frame.tick
    }
    const ack = second.frames[ackIndex]
    const exact = await waitFor(
      () => second.frames[ackIndex + 1],
      'exact post-ack snapshot timed out',
    )
    if (ack?.type !== 'ack' || exact.type !== 'snapshot') {
      throw new Error('waiting command was not followed by an exact snapshot')
    }
    expect(exact.sequence).toBe(ack.sequence)
    expect(exact.epoch).toBe(seeded.runtime.host.run.epoch)
    expect(exact.tick).toBe(ack.tick)
    expect(exact.projection.sequence).toBe(ack.sequence)
    expect(exact.projection.self.facing).toBe('west')
    expect(exact.projection).toEqual(
      seeded.runtime.host.run.project(dungeonProjection, viewer('player-two')),
    )

    const resetStart = second.frames.length
    first.socket.send(wireCommand('paused-reset-a', { type: 'move', direction: 'north' }))
    await admittedResetA.promise
    const reset = seeded.runtime.reset(84, 'queued-watermark-reset')
    const resetTick = seeded.runtime.tick()
    second.socket.send(wireCommand('waiting-after-reset', { type: 'ready', ready: true }))
    await queuedResetB.promise
    releaseResetA.resolve()
    await reset
    await resetTick

    const resetAckIndex = await waitFor(() => {
      const index = second.frames.findIndex(
        (frame, candidate) =>
          candidate >= resetStart &&
          frame.type === 'ack' &&
          frame.commandId === 'waiting-after-reset',
      )
      return index < 0 ? undefined : index
    }, 'post-reset command ack timed out')
    const resetTicks = second.frames
      .slice(resetStart, resetAckIndex)
      .filter((frame): frame is SnapshotFrame => frame.type === 'snapshot')
    expect(resetTicks.map((frame) => frame.tick)).toEqual([1])
    expect(resetTicks[0]?.projection.phase).toBe('lobby')
    const resetAck = second.frames[resetAckIndex]
    const resetExact = await waitFor(
      () => second.frames[resetAckIndex + 1],
      'post-reset exact snapshot timed out',
    )
    if (resetAck?.type !== 'ack' || resetExact.type !== 'snapshot') {
      throw new Error('post-reset command was not followed by an exact snapshot')
    }
    expect(resetExact.sequence).toBe(resetAck.sequence)
    expect(resetExact.epoch).toBe(seeded.runtime.host.run.epoch)
    expect(resetExact.tick).toBe(resetAck.tick)
    expect(resetExact.projection.sequence).toBe(resetAck.sequence)
    expect(resetExact.projection.self.ready).toBe(true)
    expect(resetExact.projection).toEqual(
      seeded.runtime.host.run.project(dungeonProjection, viewer('player-two')),
    )
    first.socket.close()
    second.socket.close()
  })
})
