import { Assets, Rectangle, Texture } from 'pixi.js'
import { useEffect, useState } from 'react'
import { atlasFrameDefinitions, atlasTileSize } from './atlas'

export type DungeonTextures = Readonly<Record<string, Texture>>

export interface DungeonAtlas {
  textures: DungeonTextures
  status: 'loading' | 'ready' | 'error'
}

export const useDungeonAtlas = (): DungeonAtlas => {
  const [atlas, setAtlas] = useState<DungeonAtlas>({ textures: {}, status: 'loading' })

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const source = await Assets.load<Texture>('/assets/dungeon-atlas.png')
        source.source.scaleMode = 'nearest'
        const textures = Object.fromEntries(
          atlasFrameDefinitions().map((definition) => [
            definition.name,
            new Texture({
              source: source.source,
              frame: new Rectangle(
                definition.column * atlasTileSize,
                definition.row * atlasTileSize,
                definition.columns * atlasTileSize,
                definition.rows * atlasTileSize,
              ),
            }),
          ]),
        )
        if (active) setAtlas({ textures, status: 'ready' })
      } catch {
        if (active) setAtlas({ textures: {}, status: 'error' })
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  return atlas
}
