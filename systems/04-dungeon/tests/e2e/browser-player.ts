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

const FRAME_INTERVAL_MS = 100

/**
 * Draws the page ten times a second, once for each server tick.
 *
 * The map is a WebGL canvas. A CI runner has no GPU, so every frame of every player's page
 * is drawn in software, and at the browser's own frame rate four pages want more processor
 * time than the runner has. The pages then send moves a third as fast as the server ticks,
 * and enemies that move on the server's clock outrun the players. The journey checks what
 * the game does and not how smooth it looks.
 */
async function capFrameRate(page: Page): Promise<void> {
  await page.addInitScript((interval) => {
    window.requestAnimationFrame = (callback) =>
      window.setTimeout(() => callback(performance.now()), interval)
    window.cancelAnimationFrame = (handle) => window.clearTimeout(handle)
  }, FRAME_INTERVAL_MS)
}

export async function openPlayerPage(player: BrowserPlayer, partyId: string): Promise<void> {
  await capFrameRate(player.page)
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

const WALK_STALL_MS = 10_000

/**
 * Waits while a held key walks the player, until `arrived`.
 *
 * The page sends one move, waits for its acknowledgement and sends the next, so a busy
 * machine walks slower: three steps a second were measured on a starved one, against ten
 * on a free one. A fixed time for the whole walk therefore fails long walks that are going
 * fine. This fails when the player stops making progress, which is what a wall, a
 * dead player or a lost key press looks like, however fast the rest of the walk went.
 */
async function walkUntil(
  player: BrowserPlayer,
  axis: 'x' | 'y',
  goal: string,
  arrived: () => boolean | Promise<boolean>,
): Promise<void> {
  let last = projectionOf(player).self.position[axis]
  let lastProgress = Date.now()
  while (!(await arrived())) {
    const projection = projectionOf(player)
    const current = projection.self.position[axis]
    if (current !== last) {
      last = current
      lastProgress = Date.now()
    } else if (Date.now() - lastProgress > WALK_STALL_MS) {
      const { x, y } = projection.self.position
      throw new Error(
        `${player.id} stopped at ${x},${y} for ${WALK_STALL_MS}ms on the way to ${goal}; phase=${projection.phase}, tick=${projection.tick}, health=${projection.self.health}`,
      )
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  }
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
      await walkUntil(player, axis, `${axis} ${target}`, () =>
        increasing ? position() >= target - tolerance : position() <= target + tolerance,
      )
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
    await walkUntil(player, axis, testId, () => target.isVisible())
  } finally {
    await player.page.keyboard.up(keyFor[direction])
  }
  await waitForMovementToSettle(player, axis)
  await expect(target).toBeVisible()
}
