import { type Run, WizardError } from '@openwizard/core'
import type { SnapshotFrame } from '@openwizard/core/mirror'
import type { PlayerProjection, Viewer } from '@wizard/dungeon-shared'
import type { WorldState } from './domain.js'
import { projectState } from './projection.js'
import type { dungeonWizard } from './wizard.js'

export interface PlayerSourceSeed {
  readonly world: WorldState
  readonly sequence: number
  readonly epoch: number
}

export interface PlayerSource {
  subscribe(onFrame: (frame: SnapshotFrame<PlayerProjection>) => void): () => void
  dispose(): void
}

const projectFrame = (
  run: Run<typeof dungeonWizard>,
  viewer: Viewer,
  seed: PlayerSourceSeed,
): SnapshotFrame<PlayerProjection> => ({
  kind: 'snapshot',
  instanceId: run.id,
  epoch: seed.epoch,
  seq: seed.sequence,
  state: projectState(seed.world, viewer, seed.sequence, seed.epoch),
})

export const createPlayerSource = (
  run: Run<typeof dungeonWizard>,
  viewer: Viewer,
  durableSeed: PlayerSourceSeed,
): PlayerSource => {
  const listeners = new Set<(frame: SnapshotFrame<PlayerProjection>) => void>()
  let disposed = false
  let lastWorld = durableSeed.world
  let cachedFrame = projectFrame(run, viewer, durableSeed)

  const unsubscribeRun = run.subscribe((state) => {
    if (state.context.world === lastWorld) return
    lastWorld = state.context.world
    cachedFrame = projectFrame(run, viewer, {
      world: state.context.world,
      sequence: state.seq,
      epoch: state.epoch,
    })
    for (const listener of Array.from(listeners)) listener(cachedFrame)
  })

  return {
    subscribe(onFrame) {
      if (disposed) throw new WizardError('DISPOSED', 'player source is disposed')
      listeners.add(onFrame)
      onFrame(cachedFrame)
      return () => listeners.delete(onFrame)
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribeRun()
      listeners.clear()
    },
  }
}
