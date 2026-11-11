import type { ClientCommand, Direction } from '@wizard/dungeon-shared'

export type ControlDirection = 'up' | 'down' | 'left' | 'right'

interface HeldDirection {
  source: string
  direction: ControlDirection
}

export const movementFor = (held: readonly ControlDirection[]): Direction | null => {
  const latest = held.at(-1)
  switch (latest) {
    case 'up':
      return 'north'
    case 'down':
      return 'south'
    case 'left':
      return 'west'
    case 'right':
      return 'east'
    default:
      return null
  }
}

export class PlayerInputBuffer {
  #enabled = false
  #held: HeldDirection[] = []
  #queued: ClientCommand | null = null

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled
    if (!enabled) {
      this.#held = []
      this.#queued = null
    }
  }

  queueAction(command: ClientCommand): boolean {
    if (!this.#enabled) return false
    this.#queued = command
    return true
  }

  pressDirection(direction: ControlDirection, source: string, repeated = false): boolean {
    if (repeated || !this.#enabled) return false
    this.#held = [...this.#held.filter((entry) => entry.source !== source), { source, direction }]
    return true
  }

  releaseDirection(source: string): void {
    this.#held = this.#held.filter((entry) => entry.source !== source)
  }

  clearDirections(): void {
    this.#held = []
  }

  nextCommand(): ClientCommand | null {
    if (!this.#enabled) return null
    const action = this.#queued
    if (action !== null) {
      this.#queued = null
      return action
    }
    const direction = movementFor(this.#held.map((entry) => entry.direction))
    return direction === null ? null : { type: 'move', direction }
  }
}
