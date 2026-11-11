import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { signPlayerToken } from '@wizard/dungeon-server'
import { connectWs, type WsPeer } from './ws-peer.js'

const execFileAsync = promisify(execFile)

export const dungeonIntegration = {
  apiUrl: process.env.DUNGEON_API_URL ?? 'http://127.0.0.1:4410',
  wsUrl: process.env.DUNGEON_WS_URL ?? 'ws://127.0.0.1:4410/ws',
  jwtSecret: process.env.DUNGEON_JWT_SECRET ?? 'local-jwt-secret-change-me',
  seedKey: process.env.DUNGEON_SEED_KEY ?? 'local-seed-key',
} as const

export interface TestPlayer {
  readonly id: string
  readonly name: string
}

export async function seedParty(
  partyId: string,
  players: readonly TestPlayer[],
  seed = 1_337,
): Promise<void> {
  const response = await fetch(`${dungeonIntegration.apiUrl}/seed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Seed-Key': dungeonIntegration.seedKey,
    },
    body: JSON.stringify({ partyId, seed, players }),
  })
  if (!response.ok) {
    throw new Error(`seed failed with HTTP ${response.status}: ${await response.text()}`)
  }
}

export function tokenFor(partyId: string, playerId: string, sessionId?: string): string {
  return signPlayerToken(dungeonIntegration.jwtSecret, {
    partyId,
    playerId,
    ...(sessionId === undefined ? {} : { sessionId }),
  })
}

export async function connectPlayer(
  partyId: string,
  playerId: string,
  sessionId?: string,
): Promise<WsPeer> {
  const token = tokenFor(partyId, playerId, sessionId)
  return connectWs(`${dungeonIntegration.wsUrl}?token=${encodeURIComponent(token)}`)
}

export async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${dungeonIntegration.apiUrl}/health`)
      if (response.ok) return
    } catch {
      // The process is expected to refuse connections while Compose restarts it.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`dungeon API did not become healthy within ${timeoutMs}ms`)
}

export function composeRestartArgs(
  target: Partial<
    Pick<NodeJS.ProcessEnv, 'DUNGEON_COMPOSE_FILE' | 'DUNGEON_INTEGRATION_PROJECT'>
  > = process.env,
): string[] {
  return [
    'compose',
    ...(target.DUNGEON_INTEGRATION_PROJECT === undefined
      ? []
      : ['-p', target.DUNGEON_INTEGRATION_PROJECT]),
    '-f',
    target.DUNGEON_COMPOSE_FILE ?? 'compose.yaml',
    'restart',
    'dungeon-api',
  ]
}

export async function restartApi(): Promise<void> {
  await execFileAsync('docker', composeRestartArgs(), {
    cwd: process.cwd(),
    windowsHide: true,
  })
  await waitForHealth()
}
