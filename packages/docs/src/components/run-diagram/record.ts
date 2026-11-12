/**
 * Records a real run as a list of frames, so a docs diagram replays what the engine did instead
 * of a drawing of it. A scenario drives a run through its public API. Every state change the run
 * reports becomes a frame holding each step's status and the events that led to it.
 */
import type { AnyWizardDefinition, Run } from '@openwizard/core'
import { inspect, type Manifest, traceLine } from '@openwizard/core/inspect'
import { runAt } from '../playground/child-path'
import { createOutside, type OutsideCard } from './outside'

/** One step at one moment. `phase` is the live phase from `run.explain`, such as `waiting`. */
export interface StepFrame {
  readonly status: string
  readonly phase?: string
}

/** The state of a run after one change. */
export interface Frame {
  /** The code the caller ran to get here. */
  readonly call: string
  /** What that call does, in a sentence. */
  readonly note: string
  /** What the call returned, when it is worth showing. */
  readonly returned?: string
  /** Trace lines for the events since the previous frame. */
  readonly events: readonly string[]
  /** Statuses keyed by `stepKey`. */
  readonly steps: Readonly<Record<string, StepFrame>>
  /** The run's status, or `none` before a run exists. */
  readonly run: string
  /** Forms, service calls and events outside the run, oldest first. */
  readonly outside: readonly OutsideCard[]
}

/** What a scenario uses to tell its story. */
export interface Tape {
  /** Follow this run from now on. A second call switches to another run, as after a resume. */
  track(run: { dispose(): void }): void
  /** Wrap a service function, so the diagram shows each call to it and how it ended. */
  service<A extends unknown[], R>(
    name: string,
    call: (...args: A) => Promise<R>,
  ): (...args: A) => Promise<R>
  /** Run `action`, wait for the run to settle, and record the frames it caused. */
  beat(call: string, note: string, action?: () => unknown): Promise<void>
}

export interface Scenario {
  /** Tab label when a diagram offers several scenarios. */
  readonly label: string
  readonly wizard: AnyWizardDefinition
  play(tape: Tape): Promise<void>
}

export interface Recording {
  readonly manifest: Manifest
  readonly frames: readonly Frame[]
}

/** The key of a step in `Frame.steps`: its child path and id. */
export const stepKey = (path: readonly string[], id: string): string => [...path, id].join('/')

/** Lets promises and zero-delay timers finish, so the run reaches its next resting state. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

/** Events that repeat what the status change already shows. */
const QUIET =
  /^(transition\.|timer\.(scheduled|cleared)$|step\.(arrived|entered|runStarted|runSucceeded)$)/
/** Trace lines that describe bookkeeping a reader of a diagram does not need. */
const QUIET_TEXT = / exited -> | child run waiting$| computing idempotency key$/

const SHOWN_KEYS = ['ok', 'status', 'code', 'reason', 'duplicate', 'output'] as const

/** `{ ok: false, code: 'INVALID_INPUT' }` from a command result, or undefined for other values. */
function describeReturn(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const parts = SHOWN_KEYS.filter((key) => record[key] !== undefined).map(
    (key) => `${key}: ${JSON.stringify(record[key])}`,
  )
  if (parts.length === 0) return undefined
  const text = `{ ${parts.join(', ')} }`.replace(/"([^"]*)"/g, "'$1'")
  return text.length > 96 ? `${text.slice(0, 93)}...` : text
}

function childPaths(manifest: Manifest): readonly (readonly string[])[] {
  const seen = new Map<string, readonly string[]>()
  for (const node of manifest.nodes) seen.set(node.path.join('/'), node.path)
  return [...seen.values()]
}

/** Play a scenario against a fresh run and return every frame. */
export async function record(scenario: Scenario): Promise<Recording> {
  const manifest = inspect(scenario.wizard)
  const paths = childPaths(manifest)
  const frames: Frame[] = []
  let run: Run<AnyWizardDefinition> | undefined
  let unsubscribe: (() => void)[] = []
  let call = ''
  let note = ''
  let returned: string | undefined
  let events: string[] = []
  let framesThisBeat = 0
  let steps: Record<string, StepFrame> = Object.fromEntries(
    manifest.nodes.map((node) => [stepKey(node.path, node.id), { status: 'idle' }]),
  )

  const readSteps = (): Record<string, StepFrame> => {
    if (!run) return steps
    const next = { ...steps }
    for (const path of paths) {
      let target: Run<AnyWizardDefinition>
      try {
        target = runAt(run, path)
      } catch {
        continue // The child has not started, or has finished and kept its last statuses.
      }
      for (const [id, step] of Object.entries(target.getState().steps)) {
        const phase = target.explain(id).phase
        next[stepKey(path, id)] = phase ? { status: step.status, phase } : { status: step.status }
      }
    }
    return next
  }

  // A step calls its service just after the run reports that the step started. The call belongs
  // to that frame, so the frame is updated when the call begins.
  const outside = createOutside(() => {
    const last = frames.at(-1)
    if (last && framesThisBeat > 0) frames[frames.length - 1] = { ...last, outside: readOutside() }
  })
  const views = manifest.nodes
    .filter((node) => node.kind === 'view')
    .map((node) => ({ key: stepKey(node.path, node.id), path: node.path, id: node.id }))
  const readOutside = (): readonly OutsideCard[] =>
    outside.cards(views, (path) => {
      if (!run) return undefined
      try {
        return runAt(run, path)
      } catch {
        return undefined
      }
    })

  const push = () => {
    steps = readSteps()
    const frame: Frame = {
      call,
      note,
      events,
      steps,
      outside: readOutside(),
      run: run ? run.getState().status : 'none',
      ...(returned === undefined ? {} : { returned }),
    }
    events = []
    framesThisBeat += 1
    frames.push(frame)
  }

  const sameSteps = (frame: Frame): boolean =>
    JSON.stringify(frame.steps) === JSON.stringify(readSteps())

  const tape: Tape = {
    track(tracked) {
      for (const stop of unsubscribe) stop()
      // A scenario passes a fully typed run. The recorder reads it through the untyped API.
      const next = tracked as unknown as Run<AnyWizardDefinition>
      run = next
      unsubscribe = [
        next.subscribe(() => {
          const last = frames.at(-1)
          if (!last || framesThisBeat === 0 || !sameSteps(last)) push()
          else if (last.run !== next.getState().status) {
            // Only the run's status moved: it belongs to the frame that finished the last step.
            frames[frames.length - 1] = {
              ...last,
              run: next.getState().status,
              events: [...last.events, ...events],
              outside: readOutside(),
            }
            events = []
          }
        }),
        next.observe((event) => {
          outside.observe(event)
          if (QUIET.test(event.type)) return
          const text = traceLine(event).text
          if (!QUIET_TEXT.test(text) && events.at(-1) !== text) events.push(text)
        }),
      ]
    },
    service: outside.service,
    async beat(nextCall, nextNote, action) {
      call = nextCall
      note = nextNote
      returned = undefined
      framesThisBeat = 0
      const value = await action?.()
      await settle()
      returned = describeReturn(value)
      const last = frames.at(-1)
      if (framesThisBeat === 0 || !last) {
        push()
      } else {
        // The last change of this beat also carries what the call returned and what settled since.
        frames[frames.length - 1] = {
          ...last,
          events: [...last.events, ...events],
          outside: readOutside(),
          ...(returned === undefined ? {} : { returned }),
        }
        events = []
      }
    },
  }

  try {
    await scenario.play(tape)
  } finally {
    for (const stop of unsubscribe) stop()
  }
  return { manifest, frames }
}
