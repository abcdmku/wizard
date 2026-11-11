import { type AckFrame, type ErrorFrame, ServerFrameSchema } from '@wizard/dungeon-shared'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { z } from 'zod'
import {
  createDungeonServer,
  createMemoryPartyRepository,
  createPartyRegistry,
  type DungeonServer,
  MAX_CLIENT_MESSAGE_BYTES,
  signPlayerToken,
  verifyPlayerToken,
} from '../src/index.js'

const SeedTicketResponseSchema = z
  .object({ sessions: z.array(z.object({ token: z.string() }).passthrough()).min(1) })
  .passthrough()
const TokenLifetimeSchema = z
  .object({ iat: z.number().int().nonnegative(), exp: z.number().int().positive() })
  .passthrough()

const running: DungeonServer[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop()))
})

const startServer = async () => {
  const repository = createMemoryPartyRepository()
  const registry = createPartyRegistry({
    store: repository.store,
    directory: repository.directory,
    ownerId: 'transport-test',
  })
  const server = createDungeonServer({
    registry,
    tokenSecret: 'transport-token-secret',
    seedKey: 'transport-seed-key',
    port: 0,
  })
  running.push(server)
  return { address: await server.start(), registry }
}

describe('bounded transport input', () => {
  it('issues seed browser tickets for ten minutes', async () => {
    const { address } = await startServer()
    const response = await fetch(`${address.url}/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-seed-key': 'transport-seed-key' },
      body: JSON.stringify({
        partyId: 'ticket-expiry-party',
        seed: 42,
        players: [
          { id: 'player-one', name: 'Ada' },
          { id: 'player-two', name: 'Lin' },
        ],
      }),
    })
    expect(response.status).toBe(201)
    const responseBody: unknown = await response.json()
    const ticketResponse = SeedTicketResponseSchema.parse(responseBody)
    const token = ticketResponse.sessions[0]?.token
    if (token === undefined) throw new Error('seed response omitted its browser ticket')
    const encodedClaims = token.split('.')[1]
    if (encodedClaims === undefined) throw new Error('browser ticket omitted its claims')
    const decodedClaims: unknown = JSON.parse(
      Buffer.from(encodedClaims, 'base64url').toString('utf8'),
    )
    const claims = TokenLifetimeSchema.parse(decodedClaims)
    expect(claims.exp - claims.iat).toBeGreaterThanOrEqual(599)
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600)
    expect(verifyPlayerToken('transport-token-secret', token, claims.iat).ok).toBe(true)
    expect(verifyPlayerToken('transport-token-secret', token, claims.exp)).toEqual({
      ok: false,
      message: 'token expired',
    })
  })

  it('maps malformed and oversized HTTP bodies to client errors', async () => {
    const { address } = await startServer()
    const malformed = await fetch(`${address.url}/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-seed-key': 'transport-seed-key' },
      body: '{',
    })
    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toEqual({ error: 'request body must be valid JSON' })

    const oversized = await fetch(`${address.url}/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-seed-key': 'transport-seed-key' },
      body: JSON.stringify({ padding: 'x'.repeat(70_000) }),
    })
    expect(oversized.status).toBe(413)
    await expect(oversized.json()).resolves.toEqual({ error: 'request body is too large' })
  })

  it('closes an oversized WebSocket message before command parsing', async () => {
    const { address, registry } = await startServer()
    const seeded = await registry.seed({
      partyId: 'transport-party',
      seed: 42,
      players: [
        { id: 'player-one', name: 'Ada' },
        { id: 'player-two', name: 'Lin' },
      ],
    })
    if (!seeded.ok) throw new Error('transport party did not seed')
    const token = signPlayerToken('transport-token-secret', {
      partyId: 'transport-party',
      playerId: 'player-one',
    })
    const socket = new WebSocket(
      `${address.url.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`,
    )
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    const closed = new Promise<number>((resolve) => {
      socket.once('close', (code) => resolve(code))
    })
    socket.send(Buffer.alloc(MAX_CLIENT_MESSAGE_BYTES + 1, 0x61))
    await expect(closed).resolves.toBe(1009)
  })

  it('acks a command sent as soon as the client opens', async () => {
    const { address, registry } = await startServer()
    const partyId = 'early-command-party'
    const seeded = await registry.seed({
      partyId,
      seed: 42,
      players: [
        { id: 'player-one', name: 'Ada' },
        { id: 'player-two', name: 'Lin' },
      ],
    })
    if (!seeded.ok) throw new Error('early command party did not seed')
    const originalConnect = seeded.runtime.connect.bind(seeded.runtime)
    let releaseConnect = (): void => undefined
    const connectBlocked = new Promise<void>((resolve) => {
      releaseConnect = resolve
    })
    Object.defineProperty(seeded.runtime, 'connect', {
      configurable: true,
      value: async (playerId: string) => {
        await connectBlocked
        await originalConnect(playerId)
      },
    })
    const token = signPlayerToken('transport-token-secret', {
      partyId,
      playerId: 'player-one',
    })
    const socket = new WebSocket(
      `${address.url.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`,
    )
    const commandId = 'open-ready-command'
    const matchingAck = new Promise<AckFrame>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('early command ack timed out')), 2_000)
      socket.once('error', reject)
      socket.on('message', (raw) => {
        const decoded: unknown = JSON.parse(raw.toString())
        const parsed = ServerFrameSchema.safeParse(decoded)
        if (parsed.success && parsed.data.type === 'ack' && parsed.data.commandId === commandId) {
          clearTimeout(timeout)
          resolve(parsed.data)
        }
      })
    })
    socket.once('open', () => {
      socket.send(
        JSON.stringify({
          type: 'command',
          partyId,
          commandId,
          command: { type: 'ready', ready: true },
        }),
      )
      setTimeout(releaseConnect, 50)
    })
    await expect(matchingAck).resolves.toMatchObject({ type: 'ack', commandId, ok: true })
    socket.close()
  })

  it('keeps the parsed commandId when runtime command handling throws', async () => {
    const { address, registry } = await startServer()
    const partyId = 'command-error-party'
    const seeded = await registry.seed({
      partyId,
      seed: 42,
      players: [
        { id: 'player-one', name: 'Ada' },
        { id: 'player-two', name: 'Lin' },
      ],
    })
    if (!seeded.ok) throw new Error('command error party did not seed')
    Object.defineProperty(seeded.runtime, 'command', {
      configurable: true,
      value: async () => {
        throw new Error('forced runtime command failure')
      },
    })
    const token = signPlayerToken('transport-token-secret', {
      partyId,
      playerId: 'player-one',
    })
    const socket = new WebSocket(
      `${address.url.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`,
    )
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })

    const correlatedError = new Promise<ErrorFrame>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('correlated error frame timed out')), 2_000)
      socket.on('message', (raw) => {
        const decoded: unknown = JSON.parse(raw.toString())
        const parsed = ServerFrameSchema.safeParse(decoded)
        if (parsed.success && parsed.data.type === 'error') {
          clearTimeout(timeout)
          resolve(parsed.data)
        }
      })
    })
    socket.send(
      JSON.stringify({
        type: 'command',
        partyId,
        commandId: 'movement-command-failure',
        command: { type: 'move', direction: 'east' },
      }),
    )
    await expect(correlatedError).resolves.toMatchObject({
      type: 'error',
      commandId: 'movement-command-failure',
      error: { code: 'server-error' },
    })
    socket.close()
  })
})
