/**
 * The playground session: compiles the editor files (`sandbox-transpile`), links and imports
 * them as real ES modules (`sandbox-link`) against the host's own `@openwizard/core`,
 * `@openwizard/core/testing` and `zod`, and records what happens — every wizard the code creates
 * (`createWizard` / `resumeWizard` are wrapped to register the instance and `observe()` it), the
 * domain events, and console output — as an external store the preview panes subscribe to.
 */

import type { AnyFlow, Wizard, WizardEvent } from '@openwizard/core'
import * as core from '@openwizard/core'
import * as testing from '@openwizard/core/testing'
import * as zod from 'zod'
import { stringify } from './format'
import type { MonacoApi } from './monaco-setup'
import { type HostModules, linkAndImport } from './sandbox-link'
import { type PlaygroundDiagnostic, transpileFiles } from './sandbox-transpile'

export interface TraceEntry {
  readonly id: number
  readonly wizard: string
  readonly seq: number
  readonly at: number
  readonly path: readonly string[]
  readonly type: string
  readonly step: string | undefined
  readonly detail: string
}

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export interface ConsoleEntry {
  readonly id: number
  readonly level: ConsoleLevel
  readonly text: string
}

export interface WizardHandle {
  readonly label: string
  readonly wizard: Wizard<AnyFlow>
}

export type RunStatus = 'idle' | 'compiling' | 'running' | 'done' | 'error'

export interface RunnerSnapshot {
  readonly status: RunStatus
  readonly error: string | null
  readonly diagnostics: readonly PlaygroundDiagnostic[]
  readonly wizards: readonly WizardHandle[]
  /** Flows exported by the files but never run (graph-only preview). */
  readonly flows: readonly AnyFlow[]
  readonly trace: readonly TraceEntry[]
  readonly console: readonly ConsoleEntry[]
  readonly version: number
}

export interface PlaygroundRunner {
  subscribe(listener: () => void): () => void
  getSnapshot(): RunnerSnapshot
  /** Compile `files` (model names) with `api`, import `entry`, call its exported `drive` if any. */
  run(files: readonly string[], entry: string, api: MonacoApi): Promise<void>
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
  wizards: [],
  flows: [],
  trace: [],
  console: [],
  version: 0,
}

const isFlow = (value: unknown): value is AnyFlow =>
  typeof value === 'object' &&
  value !== null &&
  'steps' in value &&
  'name' in value &&
  typeof value.name === 'string'

const errorMessage = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

export function createRunner(): PlaygroundRunner {
  const listeners = new Set<() => void>()
  let snapshot: RunnerSnapshot = EMPTY
  let draft: {
    status: RunStatus
    error: string | null
    diagnostics: readonly PlaygroundDiagnostic[]
    wizards: WizardHandle[]
    flows: AnyFlow[]
    trace: TraceEntry[]
    console: ConsoleEntry[]
  } = { ...EMPTY, wizards: [], flows: [], trace: [], console: [] }
  let version = 0
  let nextId = 0
  let flushScheduled = false
  let restoreConsole: (() => void) | null = null
  let runChain: Promise<void> = Promise.resolve()

  const flush = () => {
    flushScheduled = false
    version += 1
    snapshot = {
      ...draft,
      wizards: [...draft.wizards],
      flows: [...draft.flows],
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

  const record = (label: string, event: WizardEvent<AnyFlow>) => {
    const step = 'step' in event && typeof event.step === 'string' ? event.step : undefined
    const rest = Object.fromEntries(
      // Envelope fields have their own columns; a zero `durationMs` is noise on every sync hook.
      Object.entries(event).filter(
        ([key, value]) => !ENVELOPE_KEYS.has(key) && !(key === 'durationMs' && value === 0),
      ),
    )
    draft.trace.push({
      id: nextId++,
      wizard: label,
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

  const register = (wizard: Wizard<AnyFlow>): void => {
    const same = draft.wizards.filter(
      (handle) => handle.wizard.flow.name === wizard.flow.name,
    ).length
    const label = same === 0 ? wizard.flow.name : `${wizard.flow.name} #${same + 1}`
    draft.wizards.push({ label, wizard })
    wizard.observe((event) => record(label, event))
    notify()
  }

  /** `createWizard`-shaped functions return the wizard registered with this session. */
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

  const hostModules = (): HostModules => ({
    '@openwizard/core': {
      ...core,
      createWizard: registering(core.createWizard, register),
      createWizardAsync: registering(core.createWizardAsync, register),
      resumeWizard: registering(core.resumeWizard, register),
      resumeWizardAsync: registering(core.resumeWizardAsync, register),
    },
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

  const disposeWizards = () => {
    for (const { wizard } of draft.wizards) wizard.dispose()
  }

  const execute = async (
    files: readonly string[],
    entry: string,
    api: MonacoApi,
  ): Promise<void> => {
    disposeWizards()
    draft = {
      status: 'compiling',
      error: null,
      diagnostics: [],
      wizards: [],
      flows: [],
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
      draft.flows = exported
        .filter(isFlow)
        .filter((flow) => !draft.wizards.some((h) => h.wizard.flow === flow))
      const main = namespaces.get(entry) ?? {}
      const drive = main.drive
      if (typeof drive === 'function') {
        // `export async function drive(wizard)`: driven with the wizard the code created, or
        // with one built from its exported `flow` (+ optional `context` / `deps`).
        let target = draft.wizards[0]?.wizard
        const flow = draft.flows[0]
        if (target === undefined && flow !== undefined) {
          target = core.createWizard(flow, {
            context: main.context ?? {},
            ...(main.deps === undefined ? {} : { deps: main.deps }),
          })
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
    dispose() {
      disposeWizards()
      restoreConsole?.()
    },
  }
}
