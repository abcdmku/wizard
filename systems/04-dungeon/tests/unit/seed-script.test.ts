import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  createMemoryPartyRepository,
  createPartyRuntime,
  signPlayerToken,
} from '@wizard/dungeon-server'
import { SeedPlayerSchema, type Viewer } from '@wizard/dungeon-shared'
import { expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

interface CapturedSeed {
  readonly partyId: string
  readonly seed: number
  readonly players: readonly { readonly id: string; readonly name: string }[]
}

function parseSeed(value: unknown): CapturedSeed {
  if (typeof value !== 'object' || value === null) throw new Error('seed body is not an object')
  const partyId = 'partyId' in value ? value.partyId : undefined
  const seed = 'seed' in value ? value.seed : undefined
  const players = 'players' in value ? value.players : undefined
  if (typeof partyId !== 'string' || typeof seed !== 'number' || !Array.isArray(players)) {
    throw new Error('seed body has the wrong shape')
  }
  return { partyId, seed, players: players.map((player) => SeedPlayerSchema.parse(player)) }
}

const viewer = (partyId: string, playerId: string): Viewer => ({
  tenantId: 'tenant-seed-regression',
  partyId,
  playerId,
  sessionId: `session-${playerId}`,
})

it('seeds exactly Mira and Tarin and their party can enter exploration', async () => {
  let captured: unknown
  const serverSecret = 'seed-response-fixture-secret'
  const sessions = [
    {
      partyId: 'starter-party',
      playerId: 'player-one',
      displayName: 'Mira',
      token: signPlayerToken(serverSecret, {
        partyId: 'starter-party',
        playerId: 'player-one',
        expiresAtSeconds: 4_000_000_000,
      }),
    },
    {
      partyId: 'starter-party',
      playerId: 'player-two',
      displayName: 'Tarin',
      token: signPlayerToken(serverSecret, {
        partyId: 'starter-party',
        playerId: 'player-two',
        expiresAtSeconds: 4_000_000_000,
      }),
    },
  ] as const
  const server = createServer(async (request, response) => {
    request.setEncoding('utf8')
    let body = ''
    for await (const chunk of request) body += String(chunk)
    captured = JSON.parse(body)
    response.writeHead(201, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ partyId: 'starter-party', seed: 42, sessions }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('seed test server has no port')
  const tcp: AddressInfo = address
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DUNGEON_SEED_ENDPOINT: `http://127.0.0.1:${tcp.port}/seed`,
    DUNGEON_JWT_SECRET: 'wrong-process-secret-that-must-not-be-used',
  }
  delete environment.DUNGEON_PARTY_ID
  delete environment.DUNGEON_SEED
  try {
    const script = fileURLToPath(new URL('../../scripts/seed.mjs', import.meta.url))
    const result = await execFileAsync(process.execPath, [script], {
      env: environment,
      windowsHide: true,
    })
    for (const session of sessions) {
      const outputLine = result.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith(`${session.playerId}:`))
      expect(outputLine).toContain(`lobby=${session.partyId}`)
      expect(outputLine).toContain(`name=${session.displayName}`)
      expect(outputLine).toContain(`token=${session.token}`)
    }
    expect(result.stdout).not.toContain(environment.DUNGEON_JWT_SECRET)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    )
  }

  const seed = parseSeed(captured)
  expect(seed).toEqual({
    partyId: 'starter-party',
    seed: 42,
    players: [
      { id: 'player-one', name: 'Mira' },
      { id: 'player-two', name: 'Tarin' },
    ],
  })

  const repository = createMemoryPartyRepository()
  const opened = await createPartyRuntime({
    partyId: seed.partyId,
    seed: seed.seed,
    players: seed.players,
    ownerId: 'seed-regression-process',
    store: repository.store,
  })
  if (!opened.ok) throw new Error(`seeded runtime failed to open: ${opened.code}`)
  try {
    for (const player of seed.players) await opened.runtime.connect(player.id)
    for (const player of seed.players) {
      const ack = await opened.runtime.command(viewer(seed.partyId, player.id), {
        commandId: `ready:${player.id}`,
        command: { type: 'ready', ready: true },
      })
      expect(ack.result).toEqual({ ok: true })
    }
    expect(opened.runtime.state().phase).toBe('ready')
    await opened.runtime.tick()
    await opened.runtime.tick()
    expect(opened.runtime.state()).toMatchObject({ phase: 'exploration', tick: 2 })
  } finally {
    await opened.runtime.dispose()
  }
})
