import type { PlayerProjection } from '@wizard/dungeon-shared'
import { describe, expect, it } from 'vitest'
import { lobbyOverlayActive, playerCanAct } from './projection'

describe('lobbyOverlayActive', () => {
  it.each<PlayerProjection['phase']>(['lobby', 'ready', 'rematch'])(
    'hides the Pixi stage during %s',
    (phase) => {
      expect(lobbyOverlayActive(phase)).toBe(true)
    },
  )

  it.each<PlayerProjection['phase']>([
    'generated',
    'exploration',
    'boss',
    'victory',
    'defeat',
    'disconnect',
    'reconnect',
  ])('keeps the stage available during %s', (phase) => {
    expect(lobbyOverlayActive(phase)).toBe(false)
  })
})

describe('playerCanAct', () => {
  it('requires both alive status and positive health', () => {
    expect(playerCanAct({ status: 'alive', health: 1 })).toBe(true)
    expect(playerCanAct({ status: 'downed', health: 10 })).toBe(false)
    expect(playerCanAct({ status: 'alive', health: 0 })).toBe(false)
    expect(playerCanAct({ status: 'escaped', health: 10 })).toBe(false)
  })
})
