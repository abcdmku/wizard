import type { DungeonMap } from '@wizard/dungeon-shared'
import type { Graphics, Texture } from 'pixi.js'
import { memo, useEffect, useMemo, useRef } from 'react'
import type { DungeonTextures } from './useDungeonAtlas'

const keepGraphics = (): void => {}

const floorColor = (tile: string): number => {
  switch (tile) {
    case '#':
      return 0x11161c
    case '^':
      return 0x3b1715
    case '+':
      return 0x4a382c
    default:
      return 0x20272b
  }
}

const FallbackMap = ({ map }: { map: DungeonMap }) => {
  const graphicsRef = useRef<Graphics>(null)
  useEffect(() => {
    const graphics = graphicsRef.current
    if (graphics === null) return
    graphics
      .clear()
      .rect(0, 0, map.width * map.tileSize, map.height * map.tileSize)
      .fill(0x080a0e)
    map.rows.forEach((row, y) => {
      Array.from(row).forEach((tile, x) => {
        graphics
          .rect(x * map.tileSize, y * map.tileSize, map.tileSize, map.tileSize)
          .fill(floorColor(tile))
      })
    })
  }, [map])
  return <pixiGraphics draw={keepGraphics} ref={graphicsRef} />
}

const terrainFrame = (tile: string, x: number, y: number): string => {
  if (tile === '#') return (x + y) % 7 === 0 ? 'terrain:wall_skull' : 'terrain:wall_brick'
  if (tile === '+') return 'terrain:doorway_north'
  if (tile === 'E') return 'terrain:stairs_down'
  if (tile === 'S') return 'terrain:floor_inlay'
  if (tile === '^') return 'terrain:lava'
  const name = ['floor_stone', 'floor_brick', 'floor_cracked', 'floor_moss'][(x * 7 + y * 11) % 4]
  return `terrain:${name ?? 'floor_stone'}`
}

interface TileSprite {
  key: string
  x: number
  y: number
  texture: Texture | undefined
}

interface DungeonMapLayerProps {
  map: DungeonMap
  textures: DungeonTextures
}

const DungeonMapLayerView = ({ map, textures }: DungeonMapLayerProps) => {
  const tiles = useMemo<TileSprite[]>(
    () =>
      map.rows.flatMap((row, y) =>
        Array.from(row).map((tile, x) => ({
          key: `${x}:${y}`,
          x: x * map.tileSize,
          y: y * map.tileSize,
          texture: textures[terrainFrame(tile, x, y)],
        })),
      ),
    [map, textures],
  )
  if (tiles.some((tile) => tile.texture === undefined)) return <FallbackMap map={map} />
  return (
    <pixiContainer>
      {tiles.map((tile) =>
        tile.texture === undefined ? null : (
          <pixiSprite
            key={tile.key}
            height={map.tileSize}
            texture={tile.texture}
            width={map.tileSize}
            x={tile.x}
            y={tile.y}
          />
        ),
      )}
    </pixiContainer>
  )
}

const sameMapLayer = (previous: DungeonMapLayerProps, next: DungeonMapLayerProps): boolean =>
  previous.textures === next.textures &&
  previous.map.id === next.map.id &&
  previous.map.width === next.map.width &&
  previous.map.height === next.map.height &&
  previous.map.tileSize === next.map.tileSize &&
  previous.map.rows.every((row, index) => row === next.map.rows[index])

export const DungeonMapLayer = memo(DungeonMapLayerView, sameMapLayer)
