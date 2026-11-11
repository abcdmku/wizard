import { randomUUID } from 'node:crypto'
import { type AckFrame, type ServerFrame, serializedFrameBytes } from '@wizard/dungeon-shared'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { connectPlayer, dungeonIntegration, seedParty, tokenFor } from '../helpers/integration.js'
import type { WsPeer } from '../helpers/ws-peer.js'

const peers: WsPeer[] = []

afterEach(async () => {
  await Promise.all(peers.splice(0).map((peer) => peer.close()))
})

function partyId(label: string): string {
  return `it-${label}-${randomUUID().slice(0, 8)}`
}

async function connect(party: string, playerId: string): Promise<WsPeer> {
  const peer = await connectPlayer(party, playerId, `session-${playerId}`)
  peers.push(peer)
  return peer
}

async function nextAck(peer: WsPeer, commandId: string): Promise<AckFrame> {
  const frame = await peer.next(
    (candidate) => candidate.type === 'ack' && candidate.commandId === commandId,
  )
  if (frame.type !== 'ack') throw new Error(`expected ack, received ${frame.type}`)
  return frame
}

async function nextSnapshot(peer: WsPeer, afterSequence = -1) {
  const frame = await peer.next(
    (candidate) => candidate.type === 'snapshot' && candidate.sequence > afterSequence,
  )
  if (frame.type !== 'snapshot') throw new Error(`expected snapshot, received ${frame.type}`)
  return frame
}

async function nextAuthoritativeSnapshot(peer: WsPeer, ack: AckFrame) {
  const frame = await peer.next(
    (candidate) =>
      candidate.type === 'snapshot' &&
      candidate.sequence >= ack.sequence &&
      candidate.tick >= ack.tick,
  )
  if (frame.type !== 'snapshot') throw new Error(`expected snapshot, received ${frame.type}`)
  return frame
}

async function initialFrames(peer: WsPeer) {
  const welcome = await peer.next((frame) => frame.type === 'welcome')
  const snapshot = await nextSnapshot(peer)
  if (welcome.type !== 'welcome') throw new Error(`expected welcome, received ${welcome.type}`)
  return { welcome, snapshot }
}

function command(party: string, commandId: string, body: unknown, expectedSequence?: number) {
  return {
    type: 'command',
    partyId: party,
    commandId,
    ...(expectedSequence === undefined ? {} : { expectedSequence }),
    command: body,
  }
}

function assertAuthoritative(ack: AckFrame, frame: ServerFrame): void {
  if (frame.type !== 'snapshot') throw new Error(`expected snapshot, received ${frame.type}`)
  expect(frame.sequence).toBeGreaterThanOrEqual(ack.sequence)
  expect(frame.tick).toBeGreaterThanOrEqual(ack.tick)
}

function rejectedUpgradeStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.on('error', () => undefined)
    const timeout = setTimeout(() => {
      socket.terminate()
      reject(new Error('timed out waiting for WebSocket upgrade rejection'))
    }, 5_000)
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timeout)
      response.resume()
      socket.terminate()
      resolve(response.statusCode ?? 0)
    })
    socket.once('open', () => {
      clearTimeout(timeout)
      socket.close()
      reject(new Error('unauthorized WebSocket upgrade unexpectedly succeeded'))
    })
  })
}

describe('dungeon WebSocket protocol', () => {
  it('binds one viewer per connection and follows successful commands with scoped snapshots', async () => {
    const party = partyId('scope')
    const players = [
      { id: 'scope-owner', name: 'Scope owner' },
      { id: 'scope-teammate', name: 'Scope teammate' },
    ] as const
    await seedParty(party, players)
    const owner = await connect(party, players[0].id)
    const teammate = await connect(party, players[1].id)
    const ownerInitial = await initialFrames(owner)
    const teammateInitial = await initialFrames(teammate)

    expect(ownerInitial.welcome.playerId).toBe(players[0].id)
    expect(teammateInitial.welcome.playerId).toBe(players[1].id)
    expect(ownerInitial.snapshot.projection.self.id).toBe(players[0].id)
    expect(teammateInitial.snapshot.projection.self.id).toBe(players[1].id)
    expect(ownerInitial.snapshot.projection.teammates[0]?.id).toBe(players[1].id)
    expect(teammateInitial.snapshot.projection.teammates[0]?.id).toBe(players[0].id)

    const serialized = JSON.stringify(teammateInitial.snapshot)
    expect(serialized).not.toContain('tenantId')
    expect(serialized).not.toContain('session-scope-teammate')
    expect(serialized).not.toContain('viewer')
    expect(serializedFrameBytes(teammateInitial.snapshot)).toBeLessThanOrEqual(25_000)

    owner.send(command(party, 'ready-owner', { type: 'ready', ready: true }))
    const ack = await nextAck(owner, 'ready-owner')
    expect(ack).toMatchObject({ ok: true, replayed: false })
    const snapshot = await nextAuthoritativeSnapshot(owner, ack)
    assertAuthoritative(ack, snapshot)
    expect(snapshot.projection.self.ready).toBe(true)
  })

  it('rejects stale, conflicting duplicate, spoofed, malformed, and cross-party commands', async () => {
    const ownParty = partyId('negative-own')
    const foreignParty = partyId('negative-foreign')
    await seedParty(ownParty, [
      { id: 'negative-owner', name: 'Negative owner' },
      { id: 'negative-teammate', name: 'Negative teammate' },
    ])
    await seedParty(foreignParty, [
      { id: 'foreign-owner', name: 'Foreign owner' },
      { id: 'foreign-teammate', name: 'Foreign teammate' },
    ])
    const peer = await connect(ownParty, 'negative-owner')
    const initial = await initialFrames(peer)

    const acceptedBody = command(
      ownParty,
      'durable-ready',
      { type: 'ready', ready: true },
      initial.snapshot.sequence,
    )
    peer.send(acceptedBody)
    const accepted = await nextAck(peer, 'durable-ready')
    expect(accepted).toMatchObject({ ok: true, replayed: false })
    await nextSnapshot(peer, initial.snapshot.sequence)

    peer.send(acceptedBody)
    expect(await nextAck(peer, 'durable-ready')).toMatchObject({ ok: true, replayed: true })
    peer.send(command(ownParty, 'durable-ready', { type: 'ready', ready: false }))
    expect(await nextAck(peer, 'durable-ready')).toMatchObject({
      ok: false,
      code: 'invalid-command',
    })

    peer.send(
      command(ownParty, 'stale-ready', { type: 'ready', ready: false }, initial.snapshot.sequence),
    )
    expect(await nextAck(peer, 'stale-ready')).toMatchObject({
      ok: false,
      code: 'sequence-conflict',
    })
    peer.send(command(foreignParty, 'cross-party', { type: 'ready', ready: false }))
    const forbidden = await peer.next((frame) => frame.type === 'error')
    if (forbidden.type !== 'error') throw new Error(`expected error, received ${forbidden.type}`)
    expect(forbidden.error.code).toBe('forbidden')

    peer.send({
      ...command(ownParty, 'spoofed-player', { type: 'ready', ready: false }),
      playerId: 'negative-teammate',
    })
    const spoofed = await peer.next(
      (frame) =>
        (frame.type === 'ack' && frame.commandId === 'spoofed-player') ||
        (frame.type === 'error' &&
          (frame.commandId === null || frame.commandId === 'spoofed-player')),
    )
    if (spoofed.type === 'ack') {
      if (spoofed.ok) throw new Error('spoofed command was accepted')
      expect(spoofed.code).toBe('invalid-command')
    } else if (spoofed.type === 'error') {
      expect(spoofed.error.code).toBe('invalid-command')
    } else {
      throw new Error(`expected ack or error, received ${spoofed.type}`)
    }

    peer.sendRaw('{"type":"command",')
    const malformed = await peer.next((frame) => frame.type === 'error')
    if (malformed.type !== 'error') throw new Error(`expected error, received ${malformed.type}`)
    expect(malformed.error.code).toBe('invalid-command')
  })

  it('closes unauthenticated and unknown-player connections', async () => {
    const party = partyId('auth')
    await seedParty(party, [
      { id: 'auth-owner', name: 'Auth owner' },
      { id: 'auth-teammate', name: 'Auth teammate' },
    ])
    const cases = [
      { url: `${dungeonIntegration.wsUrl}?token=not-a-token`, status: 401 },
      {
        url: `${dungeonIntegration.wsUrl}?token=${encodeURIComponent(tokenFor(party, 'not-in-party'))}`,
        status: 403,
      },
    ]
    for (const rejection of cases) {
      expect(await rejectedUpgradeStatus(rejection.url)).toBe(rejection.status)
    }
  })
})
