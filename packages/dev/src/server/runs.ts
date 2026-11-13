import type { AnyWizardDefinition, RunEvent } from '@openwizard/core'
import type { Action, ActionResult, RunDetail, RunSummary, Services, StartRequest } from '../wire'
import type { AnyRun } from './children'
import { createDevClock, type DevClock } from './clock'
import { createManualDeps, type ManualDeps } from './manual-deps'
import { forPerson, pendingOf, timerOf } from './pending'
import { perform } from './perform'
import type { Loaded, Registry } from './registry'

/** How many events a run keeps for the history table. */
const MAX_EVENTS = 5_000

/** One run the dev server holds in memory. */
export interface Held {
  readonly id: string
  readonly loaded: Loaded
  /** The live run. `restart` replaces it. */
  run: AnyRun
  readonly input: unknown
  readonly services: Services
  readonly clock: DevClock
  readonly manual: ManualDeps
  readonly events: RunEvent<AnyWizardDefinition>[]
  readonly createdAt: number
  updatedAt: number
  readonly stop: () => void
  /** Disposes the run and resumes it from its snapshot, as a restarted process would. */
  readonly restart: () => ActionResult
}

/** The runs of a dev server. They live in memory and end with the process. */
export interface RunStore {
  start(request: StartRequest): ActionResult & { readonly id?: string }
  list(): readonly RunSummary[]
  get(id: string): RunDetail | undefined
  act(id: string, action: Action): Promise<ActionResult>
  remove(id: string): boolean
  dispose(): void
}

type Create = (input: unknown, options: Record<string, unknown>) => AnyRun
type Resume = (snapshot: unknown, options: Record<string, unknown>) => AnyRun

/** Reads the message and the issues from an error `wizard.create` threw. */
function refusal(error: unknown): ActionResult {
  const message = error instanceof Error ? error.message : String(error)
  const issues = (error as { issues?: ActionResult['issues'] }).issues
  return { ok: false, message, ...(issues === undefined ? {} : { issues }) }
}

/**
 * Holds the runs a person starts from the UI. `registry` returns the wizards as they are now,
 * and `onChange` is called with a run id whenever that run has something new to show.
 */
export function createRunStore(registry: () => Registry, onChange: (id: string) => void): RunStore {
  const held = new Map<string, Held>()

  const summary = (item: Held): RunSummary => {
    const current = registry().find(item.loaded.info.name)
    return {
      id: item.id,
      wizard: item.loaded.info.name,
      status: item.run.getState().status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      services: item.services,
      stale: current?.info.manifest.fingerprint !== item.loaded.info.manifest.fingerprint,
      waiting: pendingOf(item).filter(forPerson).length,
    }
  }

  /** `run.explain` of each root step: its live phase and the reasons it has not started. */
  const explain = (item: Held) => {
    const phases: Record<string, string> = {}
    const reasons: Record<string, readonly string[]> = {}
    for (const node of item.loaded.info.manifest.nodes) {
      if (node.path.length > 0) continue
      const facts = item.run.explain(node.id)
      if (facts.phase !== undefined) phases[node.id] = facts.phase
      if (facts.reasons.length > 0) reasons[node.id] = facts.reasons
    }
    return { phases, reasons }
  }

  return {
    start(request) {
      const loaded = registry().find(request.wizard)
      if (loaded === undefined) return { ok: false, message: `No wizard named ${request.wizard}.` }
      const services: Services =
        request.services ?? (loaded.dev.deps === undefined ? 'manual' : 'real')
      let item: Held | undefined
      const touch = () => {
        if (item === undefined) return
        item.updatedAt = Date.now()
        onChange(item.id)
      }
      const clock = createDevClock(touch)
      const manual = createManualDeps(touch, services === 'real' ? loaded.dev.deps : undefined)
      const options = { deps: manual.deps, clock, scheduler: clock }
      let run: AnyRun
      try {
        run = (loaded.dev.wizard.create as unknown as Create)(request.input, options)
      } catch (error) {
        clock.dispose()
        return refusal(error)
      }
      const events: RunEvent<AnyWizardDefinition>[] = []
      const follow = (live: AnyRun) => [
        live.subscribe(touch),
        live.observe((event) => {
          events.push(event)
          if (events.length > MAX_EVENTS) events.shift()
          touch()
        }),
      ]
      let stops = follow(run)
      const stop = () => {
        for (const end of stops) end()
        stops = []
      }
      const current: Held = {
        id: run.id,
        loaded,
        run,
        input: request.input,
        services,
        clock,
        manual,
        events,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stop,
        restart() {
          // What a store would hold: the snapshot as JSON, with no reference to the old run.
          const snapshot: unknown = JSON.parse(JSON.stringify(current.run.getSnapshot()))
          stop()
          current.run.dispose()
          manual.dispose()
          clock.dispose()
          try {
            current.run = (loaded.dev.wizard.resume as unknown as Resume)(snapshot, options)
          } catch (error) {
            return refusal(error)
          }
          stops = follow(current.run)
          touch()
          return { ok: true }
        },
      }
      item = current
      held.set(item.id, item)
      // A step may wait on a service call for as long as the person takes, so do not await.
      void run.start().then(touch, touch)
      return { ok: true, id: item.id }
    },
    list: () => [...held.values()].map(summary).sort((a, b) => b.createdAt - a.createdAt),
    get(id) {
      const item = held.get(id)
      if (item === undefined) return undefined
      const result = item.run.result()
      const nextTimer = item.clock.next()
      const timer = timerOf(item)
      return {
        ...summary(item),
        input: item.input,
        snapshot: item.run.getSnapshot(),
        ...explain(item),
        pending: pendingOf(item),
        events: [...item.events],
        ...(result === undefined ? {} : { result }),
        now: item.clock.now(),
        ...(nextTimer === undefined ? {} : { nextTimer }),
        ...(timer === undefined ? {} : { timer }),
      }
    },
    async act(id, action) {
      const item = held.get(id)
      if (item === undefined) return { ok: false, message: `No run with id ${id}.` }
      try {
        return await perform(item, action)
      } catch (error) {
        return refusal(error)
      }
    },
    remove(id) {
      const item = held.get(id)
      if (item === undefined) return false
      held.delete(id)
      item.stop()
      item.manual.dispose()
      item.clock.dispose()
      item.run.dispose()
      return true
    },
    dispose() {
      for (const id of [...held.keys()]) this.remove(id)
    },
  }
}
