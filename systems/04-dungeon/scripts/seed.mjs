#!/usr/bin/env node

import { z } from 'zod'
import { applyDungeonUrlDefaults, loadDungeonEnv } from './load-env.mjs'

loadDungeonEnv()
applyDungeonUrlDefaults()

const apiUrl =
  process.env.DUNGEON_API_URL ?? `http://127.0.0.1:${process.env.DUNGEON_API_PORT ?? '4410'}`
const endpoint = process.env.DUNGEON_SEED_ENDPOINT ?? `${apiUrl}/seed`
const seedKey = process.env.DUNGEON_SEED_KEY ?? 'local-seed-key'
const partyId = process.env.DUNGEON_PARTY_ID ?? 'starter-party'
const seed = Number(process.env.DUNGEON_SEED ?? 42)

const accounts = [
  {
    id: 'player-one',
    name: 'Mira',
  },
  {
    id: 'player-two',
    name: 'Tarin',
  },
]

const SeedSessionSchema = z
  .object({
    partyId: z.string().trim().min(1).max(64),
    playerId: z.string().trim().min(1).max(64),
    displayName: z.string().trim().min(1).max(64),
    token: z.string().min(1),
  })
  .strict()

const SeedResponseSchema = z
  .object({
    partyId: z.string().trim().min(1).max(64),
    seed: z.number().int().nonnegative(),
    sessions: z.array(SeedSessionSchema).min(2).max(4),
  })
  .strict()

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'X-Seed-Key': seedKey,
  },
  body: JSON.stringify({
    partyId,
    seed,
    players: accounts,
  }),
})

const body = await response.text()
if (!response.ok) {
  throw new Error(
    `Seed failed with HTTP ${response.status} at ${endpoint}. ${body || 'The API returned no details.'}`,
  )
}

let seeded
try {
  seeded = SeedResponseSchema.parse(JSON.parse(body))
} catch (error) {
  throw new Error(
    `Seed returned an invalid session response at ${endpoint}. ${
      error instanceof Error ? error.message : String(error)
    }`,
  )
}

if (seeded.sessions.some((session) => session.partyId !== seeded.partyId)) {
  throw new Error(`Seed returned a session for a different party than ${seeded.partyId}.`)
}

console.log(`Seeded ${seeded.partyId} with the player-bound-key fixture.`)

for (const session of seeded.sessions) {
  const url = new URL(
    process.env.DUNGEON_WEB_URL ?? `http://localhost:${process.env.DUNGEON_WEB_PORT ?? '4400'}`,
  )
  url.searchParams.set('tenant', 'local')
  url.searchParams.set('player', session.playerId)
  url.searchParams.set('lobby', session.partyId)
  url.searchParams.set('name', session.displayName)
  url.searchParams.set('token', session.token)
  console.log(`${session.playerId}: ${url}`)
}
