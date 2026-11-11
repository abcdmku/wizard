import { check, fail } from 'k6'
import crypto from 'k6/crypto'
import encoding from 'k6/encoding'
import http from 'k6/http'
import { activePartiesFromHealth } from './health.js'

function base64Url(value) {
  return encoding.b64encode(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

export function signPlayerToken(secret, playerId, partyId) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64Url(
    JSON.stringify({ sub: playerId, partyId, exp: Math.floor(Date.now() / 1_000) + 600 }),
  )
  const unsigned = `${header}.${payload}`
  const signature = crypto.hmac('sha256', secret, unsigned, 'base64')
  return `${unsigned}.${signature.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')}`
}

export function utf8Bytes(value) {
  const encoded = encoding.b64encode(value)
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  return Math.floor((encoded.length * 3) / 4) - padding
}

export function requireActiveParties(baseUrl, expected, stage) {
  const response = http.get(`${baseUrl}/health`)
  let body
  try {
    body = response.json()
  } catch {
    fail(`health ${stage} returned invalid JSON`)
  }
  const activeParties = activePartiesFromHealth(body)
  if (response.status !== 200 || activeParties !== expected) {
    fail(
      `health ${stage} expected ${expected} active parties, got HTTP ${response.status} and ${activeParties}`,
    )
  }
  return activeParties
}

export function seedParties(baseUrl, seedKey, partyCount, playersPerParty) {
  const runId = `${Date.now()}`
  const parties = []
  for (let partyIndex = 0; partyIndex < partyCount; partyIndex += 1) {
    const partyId = `load-${runId}-${partyIndex}`
    const players = Array.from({ length: playersPerParty }, (_, playerIndex) => ({
      id: `${partyId}-player-${playerIndex}`,
      name: `Load player ${partyIndex + 1}.${playerIndex + 1}`,
    }))
    const response = http.post(
      `${baseUrl}/seed`,
      JSON.stringify({ partyId, seed: 10_000 + partyIndex, players }),
      { headers: { 'Content-Type': 'application/json', 'X-Seed-Key': seedKey } },
    )
    if (!check(response, { 'party seed succeeds': (result) => result.status === 201 })) {
      fail(`seed ${partyId} failed with HTTP ${response.status}: ${response.body}`)
    }
    parties.push({ partyId, players })
  }
  return parties
}
