import { type BrowserContext, expect, type Page } from '@playwright/test'
import {
  type AckFrame,
  type ClientMessage,
  ClientMessageSchema,
  type Direction,
  type PlayerProjection,
  ServerFrameSchema,
  type SnapshotFrame,
} from '@wizard/dungeon-shared'
import { tokenFor } from '../helpers/integration.js'

type CommandMessage = Extract<ClientMessage, { readonly type: 'command' }>

export interface BrowserPlayer {
  readonly id: string
  readonly name: string
  readonly page: Page
  readonly context: BrowserContext
  readonly sentCommands: CommandMessage[]
  readonly acks: AckFrame[]
  projection: PlayerProjection | null
  latestSnapshot: SnapshotFrame | null
  websocketGeneration: number
  latestSnapshotGeneration: number
  fullSnapshotCount: number
}

const keyFor: Record<Direction, string> = {
  north: 'KeyW',
  east: 'KeyD',
  south: 'KeyS',
  west: 'KeyA',
}

function decoded(payload: string | Buffer): unknown {
  try {
    return JSON.parse(typeof payload === 'string' ? payload : payload.toString())
  } catch {
    return undefined
  }
}

function observeDungeonSocket(player: BrowserPlayer): void {
  player.page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/ws') return
    player.websocketGeneration += 1
    const generation = player.websocketGeneration
    socket.on('framesent', (event) => {
      const parsed = ClientMessageSchema.safeParse(decoded(event.payload))
      if (parsed.success && parsed.data.type === 'command') {
        player.sentCommands.push(parsed.data)
      }
    })
    socket.on('framereceived', (event) => {
      const parsed = ServerFrameSchema.safeParse(decoded(event.payload))
      if (!parsed.success) return
      if (parsed.data.type === 'ack') {
        player.acks.push(parsed.data)
        return
      }
      if (parsed.data.type !== 'snapshot') return
      player.projection = parsed.data.projection
      player.latestSnapshot = parsed.data
      player.latestSnapshotGeneration = generation
      player.fullSnapshotCount += 1
    })
  })
}

export function createBrowserPlayer(
  member: { readonly id: string; readonly name: string },
  context: BrowserContext,
  page: Page,
): BrowserPlayer {
  const player: BrowserPlayer = {
    ...member,
    context,
    page,
    sentCommands: [],
    acks: [],
    projection: null,
    latestSnapshot: null,
    websocketGeneration: 0,
    latestSnapshotGeneration: 0,
    fullSnapshotCount: 0,
  }
  observeDungeonSocket(player)
  return player
}

export function projectionOf(player: BrowserPlayer): PlayerProjection {
  if (player.projection === null) throw new Error(`no projection for ${player.id}`)
  return player.projection
}

export function sentCommandAfter(
  player: BrowserPlayer,
  start: number,
  matches: (message: CommandMessage) => boolean,
): CommandMessage | undefined {
  return player.sentCommands.slice(start).find(matches)
}

export function ackFor(player: BrowserPlayer, commandId: string): AckFrame | undefined {
  return player.acks.find((frame) => frame.commandId === commandId)
}

export async function openPlayerPage(player: BrowserPlayer, partyId: string): Promise<void> {
  const token = tokenFor(partyId, player.id, `e2e-session-${player.id}`)
  const query = new URLSearchParams({ party: partyId, name: player.name, token })
  await player.page.goto(`/?${query.toString()}`)
  await expect(player.page.getByTestId('connection-status')).toHaveText('Connected')
  await expect(player.page.getByTestId('lobby-panel')).toBeVisible()
}

export async function waitForMovementToSettle(
  player: BrowserPlayer,
  axis: 'x' | 'y',
): Promise<void> {
  let last = projectionOf(player)
  let stableTicks = 0
  await expect
    .poll(
      () => {
        const current = projectionOf(player)
        if (current.tick <= last.tick) return stableTicks
        stableTicks = current.self.position[axis] === last.self.position[axis] ? stableTicks + 1 : 0
        last = current
        return stableTicks
      },
      { timeout: 5_000, intervals: [50, 100] },
    )
    .toBeGreaterThanOrEqual(2)
}

export async function moveAxis(
  player: BrowserPlayer,
  axis: 'x' | 'y',
  target: number,
  tolerance = 12,
): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = projectionOf(player).self.position[axis]
    if (Math.abs(current - target) <= tolerance) return
    const direction: Direction =
      axis === 'x' ? (current < target ? 'east' : 'west') : current < target ? 'south' : 'north'
    const increasing = direction === 'east' || direction === 'south'
    await player.page.bringToFront()
    await player.page.keyboard.down(keyFor[direction])
    try {
      const position = () => projectionOf(player).self.position[axis]
      if (increasing) {
        await expect
          .poll(position, { timeout: 12_000, intervals: [50, 100] })
          .toBeGreaterThanOrEqual(target - tolerance)
      } else {
        await expect
          .poll(position, { timeout: 12_000, intervals: [50, 100] })
          .toBeLessThanOrEqual(target + tolerance)
      }
    } finally {
      await player.page.keyboard.up(keyFor[direction])
    }
    await waitForMovementToSettle(player, axis)
    const settled = projectionOf(player).self.position[axis]
    if (Math.abs(settled - target) <= tolerance) return
  }
  const self = projectionOf(player).self
  const crossAxis = axis === 'x' ? 'y' : 'x'
  throw new Error(
    `could not move ${player.id} ${axis} to ${target}; current=${self.position[axis]}, ${crossAxis}=${self.position[crossAxis]}, health=${self.health}`,
  )
}

export async function movePlayers(
  players: readonly BrowserPlayer[],
  axis: 'x' | 'y',
  target: number,
  tolerance: number,
): Promise<void> {
  await Promise.all(players.map((player) => moveAxis(player, axis, target, tolerance)))
}

export async function moveUntilVisible(
  player: BrowserPlayer,
  direction: Direction,
  testId: string,
): Promise<void> {
  const target = player.page.getByTestId(testId)
  const axis = direction === 'east' || direction === 'west' ? 'x' : 'y'
  if (await target.isVisible()) return
  await player.page.bringToFront()
  await player.page.keyboard.down(keyFor[direction])
  try {
    await expect(target).toBeVisible({ timeout: 12_000 })
  } finally {
    await player.page.keyboard.up(keyFor[direction])
  }
  await waitForMovementToSettle(player, axis)
  await expect(target).toBeVisible()
}
