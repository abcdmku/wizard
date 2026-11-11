/** Data-join gates, pull activation, and propagation of unavailable branch outputs. */
import type { CompiledFlow, NeedSpec } from '../authoring/compiled'
import type { Batch } from './batch'
import { emit } from './batch'
import type { StepRecord, WizardState } from './state'

function satisfied(need: NeedSpec, state: WizardState): boolean {
  if (need.kind === 'any') return need.steps.some((id) => state.steps[id]?.status === 'done')
  return need.steps.every((id) => {
    const status = state.steps[id]?.status
    return (
      status === 'done' ||
      (need.kind === 'optional' &&
        (status === 'skipped' || status === 'failed' || status === 'cancelled'))
    )
  })
}

export function needsSatisfied(def: CompiledFlow, state: WizardState, id: string): boolean {
  return Object.values(def.steps[id]?.needs ?? {}).every((need) => satisfied(need, state))
}

/** Missing producer ids, shared by readiness explanations and unreachable-join errors. */
export function unmetNeeds(def: CompiledFlow, state: WizardState, id: string): readonly string[] {
  const missing = new Set<string>()
  for (const need of Object.values(def.steps[id]?.needs ?? {})) {
    if (satisfied(need, state)) continue
    for (const producer of need.steps) {
      if (state.steps[producer]?.status !== 'done') missing.add(producer)
    }
  }
  return [...missing]
}

/** A skipped required producer has no output. Optional needs still accept that completion. */
export function needsSkipReason(
  def: CompiledFlow,
  state: WizardState,
  id: string,
): 'needs-skipped' | undefined {
  for (const need of Object.values(def.steps[id]?.needs ?? {})) {
    if (need.kind === 'optional') continue
    const skipped = (producer: string) => state.steps[producer]?.status === 'skipped'
    if (need.kind === 'all' ? need.steps.some(skipped) : need.steps.every(skipped))
      return 'needs-skipped'
  }
  return undefined
}

interface Graph {
  readonly successors: ReadonlyMap<string, readonly string[]>
  readonly predecessors: ReadonlyMap<string, readonly string[]>
  readonly starts: ReadonlySet<string>
}

const graphs = new WeakMap<CompiledFlow, Graph>()

/** Alternate edges count as possible arrivals, but are never followed by skip propagation. */
function graph(def: CompiledFlow): Graph {
  let cached = graphs.get(def)
  if (cached !== undefined) return cached
  const successors = new Map<string, readonly string[]>()
  const predecessors = new Map<string, string[]>()
  for (const id of def.order) {
    const step = def.steps[id]
    if (step === undefined) continue
    const next = step.next.kind === 'none' ? [] : (step.next.targets ?? [])
    successors.set(id, next)
    const arrivals = new Set([
      ...next,
      ...(def.feeds?.[id] ?? []),
      ...(step.fallback === undefined ? [] : [step.fallback]),
      ...(step.waitTimeout === undefined ? [] : [step.waitTimeout.next]),
    ])
    for (const target of arrivals) {
      const previous = predecessors.get(target) ?? []
      previous.push(id)
      predecessors.set(target, previous)
    }
  }
  cached = { successors, predecessors, starts: new Set(def.start) }
  graphs.set(def, cached)
  return cached
}

function inactive(record: StepRecord | undefined): record is StepRecord {
  return record !== undefined && (record.status === 'idle' || record.pendingActivation)
}

interface Affected {
  readonly producer: string
  readonly cascade: boolean
}

/** Process each affected edge once. A join runs once even if further any-producers finish later. */
function updateConsumers(b: Batch, seeds: readonly Affected[]): void {
  const def = b.env.def
  const facts = graph(def)
  const queue = [...seeds]
  for (let i = 0; i < queue.length; i++) {
    const affected = queue[i]
    if (affected === undefined) continue
    const { producer, cascade } = affected
    for (const id of def.feeds?.[producer] ?? []) {
      const record = b.state.steps[id]
      const revive =
        record?.status === 'skipped' &&
        (record.skipReason === 'needs-skipped' || record.skipReason === 'not-taken')
      if (record === undefined || (!inactive(record) && !revive)) continue
      if (needsSkipReason(def, b.state, id) !== undefined) {
        if (!inactive(record)) continue
        emit(b, { type: 'step.skipped', step: id, reason: 'needs-skipped' })
        queue.push({ producer: id, cascade })
      } else if (
        !record.pendingActivation &&
        (record.status === 'idle' || (revive && needsSatisfied(def, b.state, id)))
      ) {
        // Arrival records a participating join even when its remaining producers have not
        // completed. Readiness still gates entry, and quiescence can diagnose missing work.
        emit(b, { type: 'step.arrived', step: id, from: producer })
      }
    }
    if (!cascade) continue
    for (const id of facts.successors.get(producer) ?? []) {
      // A pull join decides from its needs, including optional producers. It is not owned
      // solely by the branch that also happens to have an explicit edge to it.
      if (
        !inactive(b.state.steps[id]) ||
        facts.starts.has(id) ||
        def.steps[id]?.needs !== undefined
      )
        continue
      const predecessors = facts.predecessors.get(id) ?? []
      if (
        predecessors.length === 0 ||
        !predecessors.every((p) => b.state.steps[p]?.status === 'skipped')
      )
        continue
      emit(b, { type: 'step.skipped', step: id, reason: 'not-taken' })
      queue.push({ producer: id, cascade: true })
    }
  }
}

/** Called after a producer completes or skips. No producer needs to declare next to its joins. */
export function activateFeeds(b: Batch, producer: string): void {
  updateConsumers(b, [{ producer, cascade: false }])
}

/** Untaken branch seeds were already marked skipped by the routing decision. */
export function propagateSkipped(b: Batch, seeds: readonly string[]): void {
  updateConsumers(
    b,
    seeds.map((producer) => ({ producer, cascade: true })),
  )
}

const processed = new WeakMap<Batch, number>()

/** Consume newly emitted producer events before the scheduler asks when or starts any work. */
export function synchronizeNeeds(b: Batch): void {
  let i = processed.get(b) ?? 0
  while (i < b.events.length) {
    const event = b.events[i++]
    processed.set(b, i)
    if (event === undefined) continue
    if (
      event.type === 'step.done' ||
      (event.type === 'step.exited' && event.direction !== 'back')
    ) {
      activateFeeds(b, event.step)
    } else if (event.type === 'step.skipped') {
      if (event.reason === 'not-taken' || event.reason === 'needs-skipped')
        propagateSkipped(b, [event.step])
      else activateFeeds(b, event.step)
    } else if (event.type === 'step.arrived') {
      if (
        inactive(b.state.steps[event.step]) &&
        needsSkipReason(b.env.def, b.state, event.step) !== undefined
      )
        emit(b, { type: 'step.skipped', step: event.step, reason: 'needs-skipped' })
    } else if (event.type === 'flow.resumed') {
      for (const id of b.env.def.order) {
        const record = b.state.steps[id]
        if (record?.status === 'done' || record?.status === 'skipped') activateFeeds(b, id)
      }
    }
  }
}
