/** Stage child removals without disposing their live runtimes before commit. */
import type { CompiledWizard } from '../authoring/compiled'
import { parseEachChildAddress } from '../machine/child-address'
import type { Effect } from '../machine/effects'
import { setOwn } from '../machine/util'
import type { Snapshot } from '../wizard/snapshot'

export function hasChildDisposals(effects: readonly Effect[]): boolean {
  return effects.some((effect) => effect.kind === 'child.dispose')
}

export function stageChildSnapshots(
  def: CompiledWizard,
  snapshots: Readonly<Record<string, Snapshot>>,
  effects: readonly Effect[],
): Record<string, Snapshot> {
  const removed = new Set<string>()
  for (const effect of effects) {
    if (effect.kind === 'child.dispose') removed.add(effect.step)
  }
  const staged: Record<string, Snapshot> = {}
  for (const [address, snapshot] of Object.entries(snapshots)) {
    const owner = Object.hasOwn(def.steps, address) ? address : parseEachChildAddress(address)?.step
    if (removed.has(address) || (owner !== undefined && removed.has(owner))) continue
    setOwn(staged, address, snapshot)
  }
  return staged
}
