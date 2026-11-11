import { randomUUID } from 'node:crypto'
import { createPostgresPersistence } from '@wizard/dungeon-server'
import { afterEach, describe, expect, it } from 'vitest'
import { connectPlayer, restartApi, seedParty } from '../helpers/integration.js'
import { type WsPeer, waitForWsClose } from '../helpers/ws-peer.js'

const peers: WsPeer[] = []

afterEach(async () => {
  await Promise.all(peers.splice(0).map((peer) => peer.close()))
})

function databaseUrl(): string {
  const configured = process.env.DUNGEON_TEST_DATABASE_URL ?? process.env.DUNGEON_DATABASE_URL
  if (configured !== undefined) return configured
  const user = process.env.DUNGEON_DB_USER ?? 'dungeon'
  const password = process.env.DUNGEON_DB_PASSWORD ?? 'local-only'
  const port = process.env.DUNGEON_POSTGRES_PORT ?? '5432'
  const database = process.env.DUNGEON_DB_NAME ?? 'dungeon'
  return `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`
}

async function connect(partyId: string, playerId: string): Promise<WsPeer> {
  const peer = await connectPlayer(partyId, playerId, `restart-${playerId}`)
  peers.push(peer)
  await peer.next((frame) => frame.type === 'welcome')
  return peer
}

async function lobbySnapshot(peer: WsPeer) {
  const frame = await peer.next(
    (candidate) => candidate.type === 'snapshot' && candidate.projection.phase === 'lobby',
    10_000,
  )
  if (frame.type !== 'snapshot') throw new Error(`expected snapshot, received ${frame.type}`)
  return frame
}

async function commandAck(peer: WsPeer, commandId: string) {
  const frame = await peer.next(
    (candidate) => candidate.type === 'ack' && candidate.commandId === commandId,
  )
  if (frame.type !== 'ack') throw new Error(`expected ack, received ${frame.type}`)
  return frame
}

describe('Postgres party restart', () => {
  it('reopens active party keys and durably replays a commandId after API restart', async () => {
    const partyId = `it-restart-${randomUUID().slice(0, 8)}`
    const ownerId = 'restart-owner'
    await seedParty(partyId, [
      { id: ownerId, name: 'Restart owner' },
      { id: 'restart-teammate', name: 'Restart teammate' },
    ])

    const persistence = createPostgresPersistence(databaseUrl())
    try {
      const active = await persistence.directory.list()
      expect(active).toContainEqual({ partyId, runKey: `party:${partyId}` })
    } finally {
      await persistence.close()
    }

    const firstPeer = await connect(partyId, ownerId)
    const before = await lobbySnapshot(firstPeer)
    const durableCommand = {
      type: 'command',
      partyId,
      commandId: 'ready-across-restart',
      command: { type: 'ready', ready: true },
    } as const
    firstPeer.send(durableCommand)
    const firstAck = await commandAck(firstPeer, durableCommand.commandId)
    expect(firstAck).toMatchObject({ ok: true, replayed: false })
    const applied = await firstPeer.next(
      (frame) =>
        frame.type === 'snapshot' &&
        frame.sequence >= firstAck.sequence &&
        frame.tick >= firstAck.tick,
    )
    if (applied.type !== 'snapshot') {
      throw new Error(`expected snapshot, received ${applied.type}`)
    }
    expect(applied.projection.self.ready).toBe(true)
    expect(applied.sequence).toBeGreaterThan(before.sequence)
    const disconnected = waitForWsClose(firstPeer.socket, 30_000)
    await restartApi()
    expect((await disconnected).code).toBeGreaterThan(0)
    const secondPeer = await connect(partyId, ownerId)
    const restored = await lobbySnapshot(secondPeer)
    expect(restored.projection.self.ready).toBe(true)

    secondPeer.send(durableCommand)
    const replay = await commandAck(secondPeer, durableCommand.commandId)
    expect(replay).toMatchObject({ ok: true, replayed: true })

    secondPeer.send({
      ...durableCommand,
      command: { type: 'ready', ready: false },
    })
    const conflict = await commandAck(secondPeer, durableCommand.commandId)
    expect(conflict).toMatchObject({ ok: false, code: 'invalid-command' })
    secondPeer.send({ type: 'request-snapshot', partyId, afterSequence: 0 })
    const unchanged = await secondPeer.next((frame) => frame.type === 'snapshot')
    if (unchanged.type !== 'snapshot') {
      throw new Error(`expected snapshot, received ${unchanged.type}`)
    }
    expect(unchanged.projection.self.ready).toBe(true)
  }, 60_000)
})
