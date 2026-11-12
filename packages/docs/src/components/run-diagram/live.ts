/**
 * A real run a reader drives from a docs page. The reader fills in the forms, sends the events,
 * answers the service calls and moves time forward. Each of those calls the public `Run` API,
 * and the diagram shows the code it ran and what the run reported.
 */
import { type AnyWizardDefinition, createMemoryStore, type Run, type Store } from '@openwizard/core'
import { inspect, type JSONSchema, type Manifest } from '@openwizard/core/inspect'
import { runAt } from '../playground/child-path'
import { createManualClock, createServices, type LiveCall, type ManualClock } from './live-clock'
import { describeReturn, eventLine, issueText, show } from './live-format'

/** What an example gets to build its run: the clock, a store and services the reader answers. */
export interface LiveKit {
  /** Pass as both `clock` and `scheduler`, so timers wait for the reader. */
  readonly clock: ManualClock
  readonly store: Store
  readonly service: ReturnType<typeof createServices>['service']
}

/** One example a diagram runs. */
export interface LiveSpec {
  /** Tab label when a diagram offers several examples. */
  readonly label: string
  readonly wizard: AnyWizardDefinition
  /** The `create` call as the page would write it. */
  readonly call: string
  create(kit: LiveKit): { dispose(): void }
  /** Values a form starts with, by view id. */
  readonly drafts?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  /** Payloads an event form starts with, by event name. */
  readonly payloads?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  /** Offer to save the run, stop it and resume it from the store under `key`. */
  readonly resume?: {
    readonly key: string
    readonly call: string
    run(kit: LiveKit, snapshot: unknown): { dispose(): void }
  }
}

/** One step at one moment. `phase` is the live phase from `run.explain`, such as `waiting`. */
export interface StepFrame {
  readonly status: string
  readonly phase?: string
}

/** The key of a step: its child path and id. */
export const stepKey = (path: readonly string[], id: string): string => [...path, id].join('/')

export interface LogEntry {
  readonly id: number
  readonly call: string
  readonly returned?: string
  readonly events: readonly string[]
}

export interface LiveForm {
  readonly key: string
  readonly path: readonly string[]
  readonly id: string
  readonly schema?: JSONSchema
  readonly draft: Readonly<Record<string, unknown>>
  readonly issue?: string
}

export interface LiveEvent {
  readonly key: string
  readonly path: readonly string[]
  readonly step: string
  readonly name: string
  readonly schema?: JSONSchema
  readonly payload: Readonly<Record<string, unknown>>
}

export interface LiveState {
  readonly run: string
  readonly started: boolean
  readonly busy: boolean
  readonly steps: Readonly<Record<string, StepFrame>>
  readonly log: readonly LogEntry[]
  readonly forms: readonly LiveForm[]
  readonly events: readonly LiveEvent[]
  readonly calls: readonly LiveCall[]
  readonly nextTimer?: number
  readonly halted?: { readonly step: string; readonly message: string }
  readonly canResume: boolean
}

type AnyRun = Run<AnyWizardDefinition>

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

const childPrefix = (path: readonly string[]): string =>
  `run${path.map((part) => `.child('${part}')`).join('')}`

export interface Live {
  readonly manifest: Manifest
  subscribe(listener: () => void): () => void
  getState(): LiveState
  start(): Promise<void>
  submit(form: LiveForm, draft: Record<string, unknown>): Promise<void>
  send(event: LiveEvent, payload: Record<string, unknown>): Promise<void>
  answer(call: LiveCall, outcome: 'returned' | 'threw'): Promise<void>
  advance(): Promise<void>
  retry(step: string): Promise<void>
  saveAndResume(): Promise<void>
  dispose(): void
}

export function createLive(spec: LiveSpec): Live {
  const manifest = inspect(spec.wizard)
  const paths = [
    ...new Map(manifest.nodes.map((node) => [node.path.join('/'), node.path])).values(),
  ]
  const clock = createManualClock()
  const services = createServices(() => emit())
  const kit: LiveKit = { clock, store: createMemoryStore(), service: services.service }
  const listeners = new Set<() => void>()
  const log: LogEntry[] = []
  const issues = new Map<string, string>()
  let ids = 0
  let busy = false
  let started = false
  let ended = false
  let resumed = false
  let stops: (() => void)[] = []
  let steps: Record<string, StepFrame> = Object.fromEntries(
    manifest.nodes.map((node) => [stepKey(node.path, node.id), { status: 'idle' }]),
  )
  let run = spec.create(kit) as unknown as AnyRun
  let state: LiveState

  const entry = (call: string): LogEntry => {
    ids += 1
    const next: LogEntry = { id: ids, call, events: [] }
    log.push(next)
    return next
  }
  /** The entry of the command running now. Events the run reports while it runs belong to it. */
  let acting: number | undefined
  const patch = (id: number | undefined, change: (entry: LogEntry) => Partial<LogEntry>) => {
    const index = id === undefined ? log.length - 1 : log.findIndex((item) => item.id === id)
    const current = log[index]
    if (current) log[index] = { ...current, ...change(current) }
  }

  const readSteps = () => {
    const next = { ...steps }
    for (const path of paths) {
      let target: AnyRun
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
    steps = next
    return next
  }

  const schemaOf = (path: readonly string[], id: string) =>
    manifest.nodes.find((node) => node.id === id && node.path.join('/') === path.join('/'))?.input

  const compute = (): LiveState => {
    const runState = run.getState()
    const waits = started ? run.waitingFor() : []
    const forms: LiveForm[] = []
    const events: LiveEvent[] = []
    for (const wait of waits) {
      const key = stepKey(wait.path, wait.step)
      if (wait.kind === 'view') {
        const issue = issues.get(key)
        const schema = schemaOf(wait.path, wait.step)
        forms.push({
          key,
          path: wait.path,
          id: wait.step,
          draft: spec.drafts?.[wait.step] ?? {},
          ...(schema ? { schema } : {}),
          ...(issue ? { issue } : {}),
        })
      } else if (wait.kind === 'event') {
        for (const name of wait.events) {
          const schema = manifest.schemas.events[name]
          events.push({
            key: `${key}:${name}`,
            path: wait.path,
            step: wait.step,
            name,
            payload: spec.payloads?.[name] ?? {},
            ...(schema ? { schema } : {}),
          })
        }
      }
    }
    const failure = runState.failure
    const nextTimer = started ? clock.nextIn() : undefined
    return {
      run: runState.status,
      started,
      busy,
      steps: readSteps(),
      log: [...log],
      forms,
      events,
      calls: [...services.calls()],
      canResume: spec.resume !== undefined && started && !ended && !resumed,
      ...(nextTimer === undefined ? {} : { nextTimer }),
      ...(runState.status === 'halted' && failure?.step
        ? { halted: { step: failure.step, message: failure.error.message } }
        : {}),
    }
  }

  const reportEnd = () => {
    const status = run.getState().status
    if (ended || !['done', 'failed', 'cancelled'].includes(status)) return
    ended = true
    const end = entry('await run.awaitOutcome()')
    void run.awaitOutcome().then((outcome) => {
      const index = log.findIndex((item) => item.id === end.id)
      const returned = describeReturn(outcome)
      if (index >= 0 && returned) log[index] = { ...end, returned }
      emit()
    })
  }

  function emit() {
    reportEnd()
    state = compute()
    for (const listener of listeners) listener()
  }

  const track = (next: AnyRun) => {
    for (const stop of stops) stop()
    run = next
    stops = [
      next.subscribe(() => emit()),
      next.observe((event) => {
        const line = eventLine(event)
        if (!line) return
        patch(acting, (current) =>
          current.events.at(-1) === line ? {} : { events: [...current.events, line] },
        )
      }),
    ]
  }

  /** Log `call`, run it, let the run settle and log what it returned. */
  const act = async (call: string, action: () => unknown): Promise<unknown> => {
    if (busy) return undefined
    busy = true
    const mine = entry(call).id
    acting = mine
    emit()
    try {
      const value = await action()
      await settle()
      const returned = describeReturn(value)
      if (returned) patch(mine, () => ({ returned }))
      return value
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch(mine, () => ({ returned: `threw ${message}` }))
      return undefined
    } finally {
      busy = false
      acting = undefined
      emit()
    }
  }

  track(run)
  entry(spec.call)
  state = compute()

  return {
    manifest,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState: () => state,
    async start() {
      started = true
      await act('await run.start()', () => run.start())
    },
    async submit(form, draft) {
      const target = runAt(run, form.path)
      const prefix = childPrefix(form.path)
      await act(`await ${prefix}.setInput('${form.id}', ${show(draft, 96)})`, () =>
        target.setInput(form.id, draft as never),
      )
      const result = (await act(`await ${prefix}.next()`, () => target.next())) as
        | { ok: boolean; issues?: readonly { message: string; path?: readonly unknown[] }[] }
        | undefined
      const issue =
        result && !result.ok ? (issueText(result.issues) ?? 'The draft is invalid') : undefined
      if (issue) issues.set(form.key, issue)
      else issues.delete(form.key)
      emit()
    },
    async send(event, payload) {
      const target = runAt(run, event.path)
      await act(
        `await ${childPrefix(event.path)}.send('${event.name}', ${show(payload, 96)})`,
        () => target.send(event.name as never, payload as never),
      )
    },
    async answer(call, outcome) {
      const text =
        outcome === 'returned'
          ? `// deps.${call.name} returns ${call.reply}`
          : `// deps.${call.name} throws '${call.fail}'`
      await act(text, () => services.answer(call.id, outcome))
    },
    async advance() {
      const wait = clock.nextIn()
      if (wait === undefined) return
      const [amount, unit] =
        wait >= 3_600_000 ? [wait / 3_600_000, 'hour'] : [wait / 1_000, 'second']
      const text = amount === 1 ? `1 ${unit} passes` : `${amount} ${unit}s pass`
      await act(`// ${text}`, () => clock.advance())
    },
    async retry(step) {
      await act(`await run.retry('${step}')`, () => (run.retry as (id: string) => unknown)(step))
    },
    async saveAndResume() {
      const resume = spec.resume
      if (!resume) return
      // The old run is disposed and the new one tracked inside one action, so nothing reads a
      // disposed run in between.
      await act('await run.save(); run.dispose()', async () => {
        await run.save()
        run.dispose()
        const snapshot = await kit.store.get(resume.key)
        track(resume.run(kit, snapshot) as unknown as AnyRun)
        resumed = true
        acting = entry(resume.call).id
      })
    },
    dispose() {
      for (const stop of stops) stop()
      run.dispose()
      listeners.clear()
    },
  }
}
