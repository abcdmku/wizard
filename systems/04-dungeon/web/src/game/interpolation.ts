import type { PlayerProjection } from '@wizard/dungeon-shared'

interface BufferedProjection {
  receivedAt: number
  projection: PlayerProjection
}

type Positioned = Readonly<{
  id: string
  position: PlayerProjection['self']['position']
}>

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount

export const isProjectionDiscontinuity = (
  older: PlayerProjection,
  newer: PlayerProjection,
  olderEpoch: number,
  newerEpoch: number,
): boolean =>
  olderEpoch !== newerEpoch || newer.sequence < older.sequence || newer.partyId !== older.partyId

const interpolatePosition = <T extends Positioned>(older: T, newer: T, amount: number): T => ({
  ...newer,
  position: {
    x: lerp(older.position.x, newer.position.x, amount),
    y: lerp(older.position.y, newer.position.y, amount),
  },
})

const interpolateList = <T extends Positioned>(
  older: readonly T[],
  newer: readonly T[],
  amount: number,
): T[] => {
  const previous = new Map(older.map((entry) => [entry.id, entry]))
  return newer.map((entry) => {
    const match = previous.get(entry.id)
    return match === undefined ? entry : interpolatePosition(match, entry, amount)
  })
}

export const interpolateProjection = (
  older: PlayerProjection,
  newer: PlayerProjection,
  amount: number,
): PlayerProjection => {
  const progress = clamp01(amount)
  return {
    ...newer,
    self: interpolatePosition(older.self, newer.self, progress),
    teammates: interpolateList(older.teammates, newer.teammates, progress),
    enemies: interpolateList(older.enemies, newer.enemies, progress),
    visibleLoot: interpolateList(older.visibleLoot, newer.visibleLoot, progress),
    fixtures: interpolateList(older.fixtures, newer.fixtures, progress),
    projectiles: interpolateList(older.projectiles, newer.projectiles, progress),
  }
}

export class ProjectionFrameBuffer {
  readonly #delayMs: number
  readonly #capacity: number
  #frames: BufferedProjection[] = []

  constructor(delayMs = 120, capacity = 24) {
    this.#delayMs = delayMs
    this.#capacity = capacity
  }

  push(projection: PlayerProjection, receivedAt: number): void {
    const latest = this.#frames.at(-1)
    if (latest !== undefined && projection.sequence <= latest.projection.sequence) return
    this.#frames.push({ projection, receivedAt })
    if (this.#frames.length > this.#capacity) this.#frames.shift()
  }

  reset(projection: PlayerProjection, receivedAt: number): void {
    this.#frames = [{ projection, receivedAt }]
  }

  sample(now: number): PlayerProjection | null {
    const first = this.#frames[0]
    if (first === undefined) return null
    const target = now - this.#delayMs
    let older = first
    for (let index = 1; index < this.#frames.length; index += 1) {
      const newer = this.#frames[index]
      if (newer === undefined) continue
      if (newer.receivedAt >= target) {
        const span = newer.receivedAt - older.receivedAt
        const amount = span <= 0 ? 1 : (target - older.receivedAt) / span
        return interpolateProjection(older.projection, newer.projection, amount)
      }
      older = newer
    }
    return older.projection
  }
}
