/**
 * The playground session: compiles the editor files (`sandbox-transpile`), links and imports
 * them as real ES modules (`sandbox-link`) against the host's own `@openwizard/core`,
 * `@openwizard/core/inspect`, `@openwizard/core/mirror`, `@openwizard/core/testing` and `zod`.
 * Wizard creation methods register each run and observe its events. The preview panes read
 * those runs, their events and console output from this external store.
 */

import type { AnyWizardDefinition, Run, RunEvent } from '@openwizard/core'
import * as core from '@openwizard/core'
import * as inspectModule from '@openwizard/core/inspect'
import * as mirror from '@openwizard/core/mirror'
import * as testing from '@openwizard/core/testing'
import * as zod from 'zod'
import { stringify } from './format'
import type { MonacoApi } from './monaco-setup'
import { type HostModules, linkAndImport } from './sandbox-link'
import { type PlaygroundDiagnostic, transpileFiles } from './sandbox-transpile'

export interface TraceEntry {
  readonly id: number
  readonly run: string
  readonly seq: number
  readonly at: number
  readonly path: readonly string[]
  readonly type: string
  readonly step: string | undefined
  readonly detail: string
}

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export interface ConsoleEntry {
  readonly id: number
  readonly level: ConsoleLevel
  readonly text: string
}

export interface RunHandle {
  readonly label: string
  readonly run: Run<AnyWizardDefinition>
}

/** Runtime modules have erased types; the editor still checks their real wizard types. */
interface PlaygroundWizard extends AnyWizardDefinition {
  create(input: unknown, options?: { readonly deps?: object }): Run<AnyWizardDefinition>
  createAsync(input: unknown, options?: object): Promise<Run<AnyWizardDefinition>>
  resume(snapshot: unknown, options?: object): Run<AnyWizardDefinition>
  resumeAsync(snapshot: unknown, options?: object): Promise<Run<AnyWizardDefinition>>
}

export type RunStatus = 'idle' | 'compiling' | 'running' | 'done' | 'error'

export interface RunnerSnapshot {
  readonly status: RunStatus
  readonly error: string | null
  readonly diagnostics: readonly PlaygroundDiagnostic[]
  readonly runs: readonly RunHandle[]
  /** Wizards exported by the files but never run (graph-only preview). */
  readonly wizards: readonly PlaygroundWizard[]
  readonly trace: readonly TraceEntry[]
  readonly console: readonly ConsoleEntry[]
  readonly version: number
}

export interface PlaygroundRunner {
  subscribe(listener: () => void): () => void
  getSnapshot(): RunnerSnapshot
  /** Compile `files` (model names) with `api`, import `entry`, call its exported `drive` if any. */
  run(files: readonly string[], entry: string, api: MonacoApi): Promise<void>
  /** Drop the runs and their output, so another example does not open on the last one's result. */
  reset(): Promise<void>
  dispose(): void
}

const TRACE_LIMIT = 1000
const CONSOLE_LIMIT = 400
const ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  'seq',
  'at',
  'path',
  'type',
  'step',
  'causedBy',
])
const CONSOLE_LEVELS: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']

const EMPTY: RunnerSnapshot = {
  status: 'idle',
  error: null,
  diagnostics: [],
  runs: [],
  wizards: [],
  trace: [],
  console: [],
  version: 0,
}

const isWizard = (value: unknown): value is PlaygroundWizard =>
  typeof value === 'object' &&
  value !== null &&
  'steps' in value &&
  'name' in value &&
  typeof value.name === 'string' &&
  'create' in value &&
  typeof value.create === 'function' &&
  'createAsync' in value &&
  typeof value.createAsync === 'function' &&
  'resume' in value &&
  typeof value.resume === 'function' &&
  'resumeAsync' in value &&
  typeof value.resumeAsync === 'function'

const errorMessage = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

export function createRunner(): PlaygroundRunner {
  const listeners = new Set<() => void>()
  let snapshot: RunnerSnapshot = EMPTY
  let draft: {
    status: RunStatus
    error: string | null
    diagnostics: readonly PlaygroundDiagnostic[]
    runs: RunHandle[]
    wizards: PlaygroundWizard[]
    trace: TraceEntry[]
    console: ConsoleEntry[]
  } = { ...EMPTY, runs: [], wizards: [], trace: [], console: [] }
  let version = 0
  let nextId = 0
  let flushScheduled = false
  let restoreConsole: (() => void) | null = null
  let runChain: Promise<void> = Promise.resolve()
  const trackedWizards = new WeakSet<PlaygroundWizard>()

  const flush = () => {
    flushScheduled = false
    version += 1
    snapshot = {
      ...draft,
      runs: [...draft.runs],
      wizards: [...draft.wizards],
      trace: draft.trace.slice(-TRACE_LIMIT),
      console: draft.console.slice(-CONSOLE_LIMIT),
      version,
    }
    for (const listener of listeners) listener()
  }
  const notify = () => {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(flush)
  }

  const record = (label: string, event: RunEvent<AnyWizardDefinition>) => {
    const step = 'step' in event && typeof event.step === 'string' ? event.step : undefined
    const rest = Object.fromEntries(
      // Envelope fields have their own columns; a zero `durationMs` is noise on every sync hook.
      Object.entries(event).filter(
        ([key, value]) => !ENVELOPE_KEYS.has(key) && !(key === 'durationMs' && value === 0),
      ),
    )
    draft.trace.push({
      id: nextId++,
      run: label,
      seq: event.seq,
      at: event.at,
      path: event.path,
      type: event.type,
      step,
      detail: Object.keys(rest).length === 0 ? '' : stringify(rest, 240),
    })
    if (draft.trace.length > TRACE_LIMIT * 2) draft.trace = draft.trace.slice(-TRACE_LIMIT)
    notify()
  }

  const register = (run: Run<AnyWizardDefinition>): void => {
    if (draft.runs.some((handle) => handle.run === run)) return
    const same = draft.runs.filter((handle) => handle.run.wizard.name === run.wizard.name).length
    const label = same === 0 ? run.wizard.name : `${run.wizard.name} #${same + 1}`
    draft.runs.push({ label, run })
    run.observe((event) => record(label, event))
    notify()
  }

  /** Register both immediate and asynchronously created runs before returning them. */
  const registering =
    <A extends unknown[], R>(factory: (...args: A) => R, after: (created: Awaited<R>) => void) =>
    (...args: A): R => {
      const result = factory(...args)
      if (result instanceof Promise) {
        return result.then((created: Awaited<R>) => {
          after(created)
          return created
        }) as R
      }
      after(result as Awaited<R>)
      return result
    }

  const trackWizard = (wizard: PlaygroundWizard): PlaygroundWizard => {
    if (trackedWizards.has(wizard)) return wizard
    trackedWizards.add(wizard)
    Object.assign(wizard, {
      create: registering(wizard.create.bind(wizard), register),
      createAsync: registering(wizard.createAsync.bind(wizard), register),
      resume: registering(wizard.resume.bind(wizard), register),
      resumeAsync: registering(wizard.resumeAsync.bind(wizard), register),
    })
    // Preserve the definition's identity: run.wizard must match its exported wizard.
    if ('provide' in wizard && typeof wizard.provide === 'function') {
      const provide = wizard.provide
      Object.assign(wizard, {
        provide: (...args: unknown[]) => {
          const provided: unknown = Reflect.apply(provide, wizard, args)
          return isWizard(provided) ? trackWizard(provided) : provided
        },
      })
    }
    return wizard
  }

  const hostModules = (): HostModules => ({
    '@openwizard/core': {
      ...core,
      defineWizard: (...args: unknown[]) => {
        const wizard: unknown = Reflect.apply(core.defineWizard, undefined, args)
        if (!isWizard(wizard)) throw new Error('defineWizard did not return a wizard')
        return trackWizard(wizard)
      },
    },
    '@openwizard/core/inspect': { ...inspectModule },
    '@openwizard/core/mirror': { ...mirror },
    '@openwizard/core/testing': { ...testing },
    zod: { ...zod },
  })

  const captureConsole = () => {
    restoreConsole?.()
    const original = new Map<ConsoleLevel, (...args: unknown[]) => void>()
    for (const level of CONSOLE_LEVELS) {
      // biome-ignore lint/suspicious/noConsole: capturing the running code's console output is the feature
      original.set(level, console[level])
      console[level] = (...args: unknown[]) => {
        draft.console.push({
          id: nextId++,
          level,
          text: args.map((arg) => stringify(arg)).join(' '),
        })
        if (draft.console.length > CONSOLE_LIMIT * 2)
          draft.console = draft.console.slice(-CONSOLE_LIMIT)
        notify()
      }
    }
    restoreConsole = () => {
      for (const [level, fn] of original) console[level] = fn
      restoreConsole = null
    }
  }

  const disposeRuns = () => {
    for (const { run } of draft.runs) run.dispose()
  }

  const execute = async (
    files: readonly string[],
    entry: string,
    api: MonacoApi,
  ): Promise<void> => {
    disposeRuns()
    draft = {
      status: 'compiling',
      error: null,
      diagnostics: [],
      runs: [],
      wizards: [],
      trace: [],
      console: [],
    }
    notify()
    try {
      const { modules, diagnostics } = await transpileFiles(api, files)
      draft.diagnostics = diagnostics
      if (!modules.has(entry)) throw new Error(`${entry} did not compile`)
      draft.status = 'running'
      notify()
      captureConsole()
      const host = hostModules()
      const { namespaces } = await linkAndImport(modules, entry, host)
      const exported = [...namespaces.values()].flatMap((ns) => Object.values(ns))
      draft.wizards = exported
        .filter(isWizard)
        .filter((wizard) => !draft.runs.some((h) => h.run.wizard === wizard))
      const main = namespaces.get(entry) ?? {}
      const drive = main.drive
      if (typeof drive === 'function') {
        // `export async function drive(run)`: driven with the run the code created, or
        // with one built from its exported `wizard` (+ optional `context` / `deps`).
        let target = draft.runs[0]?.run
        const wizard = draft.wizards[0]
        if (target === undefined && wizard !== undefined) {
          if (main.deps !== undefined && (typeof main.deps !== 'object' || main.deps === null)) {
            throw new Error('Export dependencies as a deps object before calling drive(run)')
          }
          target = wizard.create(
            main.context ?? {},
            main.deps === undefined ? {} : { deps: main.deps },
          )
          register(target)
        }
        await drive(target)
      }
      draft.status = 'done'
    } catch (error) {
      draft.status = 'error'
      draft.error = errorMessage(error)
    }
    notify()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    run(files, entry, api) {
      runChain = runChain.then(() => execute(files, entry, api))
      return runChain
    },
    reset() {
      runChain = runChain.then(() => {
        disposeRuns()
        restoreConsole?.()
        draft = { ...EMPTY, runs: [], wizards: [], trace: [], console: [] }
        notify()
      })
      return runChain
    },
    dispose() {
      disposeRuns()
      restoreConsole?.()
    },
  }
}
