import metadata from '../../public/assets/dungeon-atlas.json'

export interface AtlasFrameDefinition {
  name: string
  column: number
  row: number
  columns: number
  rows: number
}

const point = (value: readonly number[]): readonly [number, number] => [
  value[0] ?? 0,
  value[1] ?? 0,
]

const namedCells = (
  group: string,
  values: Readonly<Record<string, readonly number[]>>,
): AtlasFrameDefinition[] =>
  Object.entries(values).map(([name, value]) => {
    const [column, row] = point(value)
    return { name: `${group}:${name}`, column, row, columns: 1, rows: 1 }
  })

export const atlasFrameDefinitions = (): readonly AtlasFrameDefinition[] => {
  const definitions: AtlasFrameDefinition[] = [
    ...namedCells('terrain', metadata.terrain),
    ...namedCells('item', metadata.items),
    ...namedCells('effect', metadata.effects),
    ...namedCells('object', metadata.objects),
  ]
  for (const [player, config] of Object.entries(metadata.players)) {
    const [column, row] = point(config.origin)
    config.directions.forEach((direction, directionIndex) => {
      config.frames.forEach((frame, frameIndex) => {
        definitions.push({
          name: `player:${player}:${direction}:${frame}`,
          column: column + frameIndex,
          row: row + directionIndex,
          columns: 1,
          rows: 1,
        })
      })
    })
  }
  for (const [enemy, config] of Object.entries(metadata.enemies)) {
    const [column, row] = point(config.origin)
    config.directions.forEach((direction, directionIndex) => {
      config.frames.forEach((frame, frameIndex) => {
        definitions.push({
          name: `enemy:${enemy}:${direction}:${frame}`,
          column: column + frameIndex,
          row: row + directionIndex,
          columns: 1,
          rows: 1,
        })
      })
    })
  }
  const [bossColumn, bossRow] = point(metadata.finalBoss.origin)
  metadata.finalBoss.directions.forEach((direction, directionIndex) => {
    metadata.finalBoss.frames.forEach((frame, frameIndex) => {
      definitions.push({
        name: `boss:${metadata.finalBoss.id}:${direction}:${frame}`,
        column: bossColumn + frameIndex,
        row: bossRow + directionIndex,
        columns: 1,
        rows: 1,
      })
    })
  })
  return definitions
}

export const atlasTileSize = metadata.tileSize
