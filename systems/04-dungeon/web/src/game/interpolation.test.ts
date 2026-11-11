import type { PlayerProjection } from '@wizard/dungeon-shared'
import { describe, expect, it } from 'vitest'
import {
  interpolateProjection,
  isProjectionDiscontinuity,
  ProjectionFrameBuffer,
} from './interpolation'

const at = (sequence: number, x: number): PlayerProjection => ({
  partyId: 'party-1',
  sequence,
  tick: sequence,
  phase: 'exploration',
  map: null,
  self: {
    kind: 'player',
    id: 'p1',
    displayName: 'Mira',
    position: { x, y: x * 2 },
    facing: 'east',
    health: 10,
    maxHealth: 10,
    ready: true,
    rematchVote: false,
    presence: 'connected',
    status: 'alive',
    inventory: { items: [] },
    effects: [],
  },
  teammates: [],
  enemies: [],
  visibleLoot: [],
  fixtures: [],
  projectiles: [],
  objective: {
    id: 'objective-1',
    kind: 'explore',
    label: 'Find the shared door',
    progress: 0,
    target: 1,
    completed: false,
  },
})

describe('projection interpolation', () => {
  it('moves matching entities between authoritative frames', () => {
    const result = interpolateProjection(at(1, 0), at(2, 10), 0.25)
    expect(result.self.position).toEqual({ x: 2.5, y: 5 })
  })

  it('renders 120 ms behind the receive clock', () => {
    const buffer = new ProjectionFrameBuffer(120)
    buffer.push(at(1, 0), 1_000)
    buffer.push(at(2, 10), 1_100)
    expect(buffer.sample(1_170)?.self.position.x).toBe(5)
  })

  it('ignores duplicate and stale sequences', () => {
    const buffer = new ProjectionFrameBuffer(0)
    buffer.push(at(2, 20), 200)
    buffer.push(at(1, 10), 300)
    expect(buffer.sample(300)?.sequence).toBe(2)
  })

  it('resets interpolation when a new server epoch reuses the sequence', () => {
    expect(isProjectionDiscontinuity(at(4, 0), at(4, 100), 2, 3)).toBe(true)
  })
})
