import type { Scheduler } from '@openwizard/core'
import { createMemoryDurableStore } from '@openwizard/durable'
import type { DurableStore } from '@openwizard/durable/store'
import { type ServerFrame, ServerFrameSchema, type SnapshotFrame } from '@wizard/dungeon-shared'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  createDungeonServer,
  createMemoryPartyDirectory,
  createPartyRegistry,
  type DungeonServer,
  type RegistryScheduler,
  signPlayerToken,
} from '../src/index.js'

const PARTY_ID = 'durable-visibility-party'
const quietScheduler: RegistryScheduler = {
  setInterval: (callback) => setTimeout(callback, 60_000),
  clearInterval: (handle) => clearTimeout(handle),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
}
const wizardScheduler: Scheduler = {
  setTimeout: () => ({ timer: 'inert' }),
  clearTimeout: () => undefined,
}
interface SocketCapture {
  readonly socket: WebSocket
  readonly frames: ServerFrame[]
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
const openPeer = async (url: string, playerId: string): Promise<SocketCapture> => {
  const token = signPlayerToken('durable-visibility-secret', { partyId: PARTY_ID, playerId })
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
  return { socket, frames }
}
type FailureMode = 'conflict' | 'lease'
type HeldMutation = 'command' | 'tick'
const openFixture = async (mode: 'success' | FailureMode) => {
  let now = 0
  const base = createMemoryDurableStore({ now: () => now })
  const entered = deferred()
  const release = deferred()
  let armed = false
  let stableSnapshot: unknown
  const store: DurableStore = {
    ...base,
    async commit(input) {
      if (armed && input.next !== undefined) {
        armed = false
        entered.resolve()
        await release.promise
        if (mode === 'conflict') {
          const competed = await base.commit({
            lease: input.lease,
            expected: input.expected,
            next: { value: stableSnapshot, version: input.next.version },
          })
          if (!competed.ok) throw new Error(`competing commit failed: ${competed.code}`)
        }
        if (mode === 'lease') now = 2_000
      }
      return base.commit(input)
    },
  }
  const registry = createPartyRegistry({
    store,
    directory: createMemoryPartyDirectory(),
    ownerId: `visibility-${mode}`,
    scheduler: quietScheduler,
    wizardScheduler,
    clock: { now: () => now },
    leaseTtlMs: 1_000,
  })
  const server = createDungeonServer({
    registry,
    tokenSecret: 'durable-visibility-secret',
    seedKey: 'durable-visibility-seed',
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
  if (!seeded.ok) throw new Error('visibility party did not seed')
  const first = await openPeer(address.url, 'player-one')
  const second = await openPeer(address.url, 'player-two')
  return {
    entered: entered.promise,
    first,
    second,
    registry,
    runtime: seeded.runtime,
    url: address.url,
    arm: () => {
      stableSnapshot = seeded.runtime.host.run.getSnapshot()
      armed = true
    },
    release: release.resolve,
  }
}
const requestSnapshot = async (peer: SocketCapture): Promise<SnapshotFrame> => {
  const start = peer.frames.length
  peer.socket.send(JSON.stringify({ type: 'request-snapshot', partyId: PARTY_ID }))
  return waitFor(
    () =>
      peer.frames.slice(start).find((frame): frame is SnapshotFrame => frame.type === 'snapshot'),
    'requested snapshot timed out',
  )
}
const teammateReady = (frame: SnapshotFrame): boolean | undefined =>
  frame.projection.teammates.find((player) => player.id === 'player-one')?.ready
const closeCode = (peer: SocketCapture): Promise<number> =>
  new Promise((resolve) => peer.socket.once('close', (code) => resolve(code)))
const sendReady = (peer: SocketCapture, commandId: string): void => {
  peer.socket.send(
    JSON.stringify({
      type: 'command',
      partyId: PARTY_ID,
      commandId,
      command: { type: 'ready', ready: true },
    }),
  )
}
describe('durable socket snapshot visibility', () => {
  it('keeps the prior cursor visible until a held snapshot commit succeeds', async () => {
    const fixture = await openFixture('success')
    const baseline = fixture.runtime.sequence()
    const commandStart = fixture.first.frames.length
    fixture.arm()
    sendReady(fixture.first, 'held-success')
    await fixture.entered
    const held = await requestSnapshot(fixture.second)
    expect(held.sequence).toBe(baseline)
    expect(teammateReady(held)).toBe(false)
    fixture.release()
    const ackIndex = await waitFor(() => {
      const index = fixture.first.frames.findIndex(
        (frame, candidate) =>
          candidate >= commandStart && frame.type === 'ack' && frame.commandId === 'held-success',
      )
      return index < 0 ? undefined : index
    }, 'held command ack timed out')
    const ack = fixture.first.frames[ackIndex]
    const snapshot = await waitFor(() => fixture.first.frames[ackIndex + 1], 'snapshot timed out')
    if (ack?.type !== 'ack' || snapshot.type !== 'snapshot') throw new Error('ACK order failed')
    expect(snapshot.sequence).toBe(ack.sequence)
    expect(snapshot.projection.sequence).toBe(ack.sequence)
    expect(snapshot.projection.self.ready).toBe(true)
    await waitFor(
      () =>
        fixture.second.frames.find(
          (frame): frame is SnapshotFrame =>
            frame.type === 'snapshot' && teammateReady(frame) === true,
        ),
      'committed peer snapshot timed out',
    )
  })
  it.each<FailureMode>(['conflict', 'lease'])(
    'never exposes a speculative snapshot after %s failure',
    async (mode) => {
      const fixture = await openFixture(mode)
      const baseline = fixture.runtime.sequence()
      const firstStart = fixture.first.frames.length
      const secondStart = fixture.second.frames.length
      fixture.arm()
      sendReady(fixture.first, `held-${mode}`)
      await fixture.entered
      const held = await requestSnapshot(fixture.second)
      expect(held.sequence).toBe(baseline)
      expect(held.projection.sequence).toBe(baseline)
      expect(teammateReady(held)).toBe(false)
      const firstClosed = closeCode(fixture.first)
      const secondClosed = closeCode(fixture.second)
      fixture.release()
      expect(await firstClosed).toBe(1012)
      expect(await secondClosed).toBe(1012)
      expect(fixture.runtime.state().players['player-one']?.ready).toBe(false)
      const snapshots = [
        ...fixture.first.frames.slice(firstStart),
        ...fixture.second.frames.slice(secondStart),
      ].filter((frame): frame is SnapshotFrame => frame.type === 'snapshot')
      expect(snapshots.every((frame) => frame.sequence <= baseline)).toBe(true)
      expect(snapshots.every((frame) => frame.projection.sequence <= baseline)).toBe(true)
      expect(
        snapshots.every(
          (frame) => frame.projection.self.ready === false && teammateReady(frame) !== true,
        ),
      ).toBe(true)
      await waitFor(
        () => (fixture.registry.cached(PARTY_ID) === undefined ? true : undefined),
        'failed runtime stayed cached',
      )
    },
  )
  const lateCases: readonly (readonly ['success' | FailureMode, HeldMutation])[] = [
    ['success', 'command'],
    ['success', 'tick'],
    ['conflict', 'command'],
    ['conflict', 'tick'],
    ['lease', 'command'],
    ['lease', 'tick'],
  ]
  it.each(lateCases)(
    'seeds a late same-player source durably for %s/%s',
    async (mode, mutation) => {
      const fixture = await openFixture(mode)
      const baselineSequence = fixture.runtime.sequence()
      const baselineTick = fixture.runtime.state().tick
      fixture.arm()
      const ticking = mutation === 'tick' ? fixture.runtime.tick() : undefined
      if (mutation === 'command') sendReady(fixture.first, `late-${mode}`)
      await fixture.entered
      const late = await openPeer(fixture.url, 'player-one')
      await requestSnapshot(late)
      const cursors = late.frames.flatMap((frame) =>
        frame.type === 'snapshot'
          ? [
              `${frame.sequence}:${frame.projection.sequence}:${frame.tick}:${frame.projection.self.ready}`,
            ]
          : [],
      )
      expect(new Set(cursors)).toEqual(
        new Set([`${baselineSequence}:${baselineSequence}:${baselineTick}:false`]),
      )
      const postStart = late.frames.length
      if (mode === 'success') {
        fixture.release()
        if (ticking !== undefined) expect((await ticking).result.ok).toBe(true)
        const committed = await waitFor(
          () =>
            late.frames
              .slice(postStart)
              .find((frame): frame is SnapshotFrame => frame.type === 'snapshot'),
          'late committed snapshot timed out',
        )
        expect(committed.sequence).toBeGreaterThan(baselineSequence)
        if (mutation === 'tick') expect(committed.tick).toBe(baselineTick + 1)
        else expect(committed.projection.self.ready).toBe(true)
        return
      }
      const closed = closeCode(late)
      fixture.release()
      if (ticking !== undefined) expect((await ticking).result.ok).toBe(false)
      expect(await closed).toBe(1012)
      const snapshots = late.frames
        .slice(postStart)
        .filter((frame): frame is SnapshotFrame => frame.type === 'snapshot')
      expect(snapshots).toHaveLength(0)
      expect(fixture.runtime.state().tick).toBe(baselineTick)
      expect(fixture.runtime.state().players['player-one']?.ready).toBe(false)
    },
  )
})
