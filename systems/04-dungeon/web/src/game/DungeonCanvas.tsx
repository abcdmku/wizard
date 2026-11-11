import { Application, extend, useApplication, useTick } from '@pixi/react'
import type { PlayerProjection } from '@wizard/dungeon-shared'
import { Container, Graphics, Sprite, type Texture, UPDATE_PRIORITY } from 'pixi.js'
import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react'
import { DungeonMapLayer } from './DungeonMapLayer'
import { isProjectionDiscontinuity, ProjectionFrameBuffer } from './interpolation'
import { type DungeonTextures, useDungeonAtlas } from './useDungeonAtlas'

extend({ Container, Graphics, Sprite })
const keepGraphics = (): void => {}
type EntityGroup = 'players' | 'enemies' | 'loot' | 'projectiles' | 'fixtures'
type MovingEntity =
  | PlayerProjection['self']
  | PlayerProjection['teammates'][number]
  | PlayerProjection['enemies'][number]
  | PlayerProjection['visibleLoot'][number]
  | PlayerProjection['projectiles'][number]
  | PlayerProjection['fixtures'][number]
const entityIn = (
  world: PlayerProjection,
  group: EntityGroup,
  id: string,
): MovingEntity | undefined => {
  switch (group) {
    case 'players':
      return [world.self, ...world.teammates].find((entry) => entry.id === id)
    case 'enemies':
      return world.enemies.find((entry) => entry.id === id)
    case 'loot':
      return world.visibleLoot.find((entry) => entry.id === id)
    case 'projectiles':
      return world.projectiles.find((entry) => entry.id === id)
    case 'fixtures':
      return world.fixtures.find((entry) => entry.id === id)
  }
}

const playerVariant = (id: string): string => {
  const variants = ['knight', 'ranger', 'caster', 'rogue']
  const hash = Array.from(id).reduce((total, letter) => total + letter.charCodeAt(0), 0)
  return variants[hash % variants.length] ?? 'knight'
}

const spriteName = (entity: MovingEntity): string => {
  switch (entity.kind) {
    case 'player':
      return `player:${playerVariant(entity.id)}:${entity.facing}:contact`
    case 'enemy': {
      if (entity.rank === 'boss') return `boss:dragon_lich:${entity.facing}:idle`
      const name = {
        crawler: 'rat',
        sentinel: 'dark_knight',
        wraith: 'wraith',
        'dungeon-heart': 'golem',
      }[entity.enemyType]
      const direction = entity.facing === 'north' ? 'north' : 'south'
      return `enemy:${name}:${direction}:idle`
    }
    case 'loot':
      return entity.itemKind === 'player-bound-key' ? 'item:key_ornate' : 'item:potion_health'
    case 'projectile':
      return 'effect:fireball'
    case 'shared-door':
      return entity.state === 'open' ? 'terrain:doorway_north' : 'terrain:door_shared'
    case 'fixture':
      return {
        exit: 'terrain:stairs_down',
        chest: 'terrain:chest_closed',
        switch: 'object:pressure_plate',
        altar: 'object:statue',
      }[entity.fixtureType]
  }
}

const fallbackColor = (group: EntityGroup, boss: boolean): number => {
  if (group === 'players') return 0xe8c77b
  if (group === 'loot') return 0x66e3c4
  if (group === 'fixtures') return 0x9a755b
  if (group === 'projectiles') return 0xff8b4a
  return boss ? 0xd73e68 : 0x9f5976
}

const FallbackShape = ({
  group,
  boss,
  size,
}: {
  group: EntityGroup
  boss: boolean
  size: number
}) => {
  const graphicsRef = useRef<Graphics>(null)
  useEffect(() => {
    const graphics = graphicsRef.current
    if (graphics === null) return
    const color = fallbackColor(group, boss)
    graphics.clear()
    if (group === 'fixtures')
      graphics.roundRect(-size * 0.45, -size * 0.45, size * 0.9, size * 0.9, 3).fill(color)
    else if (group === 'loot') graphics.regularPoly(0, 0, size * 0.28, 4).fill(color)
    else if (group === 'projectiles') graphics.circle(0, 0, size * 0.15).fill(color)
    else
      graphics
        .circle(0, 0, size * 0.36)
        .fill(color)
        .circle(-size * 0.1, -size * 0.08, 2)
        .fill(0x101216)
  }, [boss, group, size])
  return <pixiGraphics draw={keepGraphics} ref={graphicsRef} />
}

const HealthBar = ({
  health,
  maxHealth,
  size,
}: {
  health: number
  maxHealth: number
  size: number
}) => {
  const graphicsRef = useRef<Graphics>(null)
  useEffect(() => {
    const graphics = graphicsRef.current
    if (graphics === null) return
    const ratio = maxHealth <= 0 ? 0 : Math.max(0, Math.min(1, health / maxHealth))
    graphics
      .clear()
      .roundRect(-size * 0.45, -size * 0.62, size * 0.9, 4, 2)
      .fill(0x07090c)
      .roundRect(-size * 0.45, -size * 0.62, size * 0.9 * ratio, 4, 2)
      .fill(ratio > 0.35 ? 0x65d394 : 0xe45454)
  }, [health, maxHealth, size])
  return <pixiGraphics draw={keepGraphics} ref={graphicsRef} />
}

interface EntityNodeProps {
  group: EntityGroup
  entity: MovingEntity
  rendered: RefObject<PlayerProjection>
  texture: Texture | undefined
  size: number
  health: number | null
  maxHealth: number | null
  boss: boolean
}

const EntityNode = ({
  group,
  entity,
  rendered,
  texture,
  size,
  health,
  maxHealth,
  boss,
}: EntityNodeProps) => {
  const nodeRef = useRef<Container>(null)
  const animate = useCallback(() => {
    const current = entityIn(rendered.current, group, entity.id)
    const node = nodeRef.current
    if (current === undefined || node === null) return
    node.position.set(current.position.x, current.position.y)
    node.zIndex = current.position.y
  }, [entity.id, group, rendered])
  useTick(animate)
  return (
    <pixiContainer ref={nodeRef} x={entity.position.x} y={entity.position.y}>
      {texture === undefined ? (
        <FallbackShape boss={boss} group={group} size={size} />
      ) : (
        <pixiSprite anchor={0.5} height={size} texture={texture} width={size} />
      )}
      {health !== null && maxHealth !== null ? (
        <HealthBar health={health} maxHealth={maxHealth} size={size} />
      ) : null}
    </pixiContainer>
  )
}

const WorldScene = ({
  epoch,
  world,
  textures,
}: {
  epoch: number
  world: PlayerProjection
  textures: DungeonTextures
}) => {
  const { app } = useApplication()
  const buffer = useRef(new ProjectionFrameBuffer(120))
  const rendered = useRef(world)
  const renderedEpoch = useRef(epoch)
  const cameraRef = useRef<Container>(null)

  useEffect(() => {
    if (isProjectionDiscontinuity(rendered.current, world, renderedEpoch.current, epoch)) {
      buffer.current.reset(world, performance.now())
    } else buffer.current.push(world, performance.now())
    renderedEpoch.current = epoch
  }, [epoch, world])

  useEffect(() => {
    app.ticker.maxFPS = 60
  }, [app])

  const animate = useCallback(() => {
    const sampled = buffer.current.sample(performance.now())
    if (sampled !== null) rendered.current = sampled
    const frame = sampled ?? rendered.current
    const camera = cameraRef.current
    const map = frame.map
    if (camera === null || map === null) return
    const scale = Math.max(
      0.7,
      Math.min(1.35, Math.min(app.screen.width / 760, app.screen.height / 560)),
    )
    camera.scale.set(scale)
    const minimumX = Math.min(0, app.screen.width - map.width * map.tileSize * scale)
    const minimumY = Math.min(0, app.screen.height - map.height * map.tileSize * scale)
    camera.x = Math.max(minimumX, Math.min(0, app.screen.width / 2 - frame.self.position.x * scale))
    camera.y = Math.max(
      minimumY,
      Math.min(0, app.screen.height / 2 - frame.self.position.y * scale),
    )
  }, [app])
  useTick({ callback: animate, priority: UPDATE_PRIORITY.HIGH })

  const nodes = useMemo(
    () => [
      ...world.fixtures.map((entity) => ({ group: 'fixtures' as const, entity })),
      ...world.visibleLoot.map((entity) => ({ group: 'loot' as const, entity })),
      ...world.enemies.map((entity) => ({ group: 'enemies' as const, entity })),
      ...[world.self, ...world.teammates].map((entity) => ({ group: 'players' as const, entity })),
      ...world.projectiles.map((entity) => ({ group: 'projectiles' as const, entity })),
    ],
    [world],
  )
  const tileSize = world.map?.tileSize ?? 32

  return (
    <pixiContainer ref={cameraRef} sortableChildren>
      {world.map === null ? null : <DungeonMapLayer map={world.map} textures={textures} />}
      {nodes.map(({ group, entity }) => {
        const living = entity.kind === 'player' || entity.kind === 'enemy' ? entity : null
        const boss = entity.kind === 'enemy' && entity.rank === 'boss'
        const size = boss ? tileSize * 1.8 : tileSize
        return (
          <EntityNode
            boss={boss}
            entity={entity}
            group={group}
            health={living?.health ?? null}
            key={`${group}:${entity.id}`}
            maxHealth={living?.maxHealth ?? null}
            rendered={rendered}
            size={size}
            texture={textures[spriteName(entity)]}
          />
        )
      })}
    </pixiContainer>
  )
}

interface DungeonCanvasProps {
  epoch: number
  projection: PlayerProjection
}

export const DungeonCanvas = ({ epoch, projection }: DungeonCanvasProps) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const atlas = useDungeonAtlas()
  return (
    <div
      aria-label="Live dungeon map"
      className="canvas-shell"
      data-testid="dungeon-canvas"
      ref={hostRef}
      role="img"
    >
      <Application
        antialias={false}
        autoDensity
        backgroundColor={0x080a0e}
        preference="webgl"
        resolution={Math.min(window.devicePixelRatio, 2)}
        resizeTo={hostRef}
        sharedTicker={false}
      >
        <WorldScene epoch={epoch} textures={atlas.textures} world={projection} />
      </Application>
      {atlas.status === 'error' ? (
        <p className="asset-warning" role="status">
          Atlas unavailable. Using simple map markers.
        </p>
      ) : null}
    </div>
  )
}
