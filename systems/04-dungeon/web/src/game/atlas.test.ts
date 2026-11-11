import { describe, expect, it } from 'vitest'
import { atlasFrameDefinitions, atlasTileSize } from './atlas'

describe('dungeon atlas metadata', () => {
  it('maps original terrain and character art to named frames', () => {
    const names = new Set(atlasFrameDefinitions().map((frame) => frame.name))
    expect(atlasTileSize).toBe(32)
    expect(names).toContain('terrain:floor_stone')
    expect(names).toContain('player:knight:north:contact')
    expect(names).toContain('enemy:skeleton:north:idle')
    expect(names).toContain('boss:dragon_lich:north:idle')
    expect(names).toContain('item:key_ornate')
  })
})
