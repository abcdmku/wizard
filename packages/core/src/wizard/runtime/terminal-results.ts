/**
 * Terminal result derivation and waiter/subscription lifetime management.
 *
 * This module intentionally works on the untyped machine state. The typed
 * `FlowRun<F>` facade narrows the same runtime value to `RunResult<F>`; no
 * unknown thrown value is ever asserted to be a mapped task error here.
 *
 * @internal
 */

import type { DomainEvent } from '../../machine/events'
import { isTerminal } from '../../machine/selectors'
import type {
  CompensationFailureState,
  FlowFailureState,
  SerializedError,
  StepError,
  WizardState,
} from '../../machine/state'
import { RunLifecycleError } from '../results'

export interface RuntimeCompensationSummary {
  readonly outcome: 'failed' | 'cancelled'
  readonly failures: readonly CompensationFailureState[]
}

export type RuntimeStepFailure = {
  readonly kind: 'step'
  readonly step: string
  readonly error: StepError
  readonly compensation?: RuntimeCompensationSummary
}

export type RuntimeFailure =
  | RuntimeStepFailure
  | {
      readonly kind: 'compensation'
      readonly cause?: RuntimeStepFailure
      readonly compensation: RuntimeCompensationSummary & { readonly outcome: 'failed' }
    }
  | {
      readonly kind: 'cancelled'
      readonly reason?: string
      readonly compensation?: RuntimeCompensationSummary
    }
  | { readonly kind: 'runtime'; readonly step?: string; readonly error: SerializedError }

export type RuntimeResult =
  | {
      readonly status: 'done'
      readonly output: unknown
      readonly seq: number
      readonly epoch: number
    }
  | {
      readonly status: 'failed'
      readonly failure: Exclude<RuntimeFailure, { readonly kind: 'cancelled' }>
      readonly seq: number
      readonly epoch: number
    }
  | {
      readonly status: 'cancelled'
      readonly failure: Extract<RuntimeFailure, { readonly kind: 'cancelled' }>
      readonly seq: number
      readonly epoch: number
    }

export interface TerminalResultTracker {
  current(): RuntimeResult | undefined
  awaitResult(): Promise<RuntimeResult>
  subscribe(listener: (result: RuntimeResult) => void): () => void
  commit(state: WizardState, batch: readonly DomainEvent[]): void
  dispose(): void
}

export function deriveRuntimeResult(state: WizardState): RuntimeResult | undefined {
  if (!isTerminal(state)) return undefined

  const terminal = state.terminal
  const compensation = toCompensationSummary(state, terminal?.compensation)
  if (state.status === 'done') {
    return {
      status: 'done',
      output: terminal?.output ?? state.output,
      seq: state.seq,
      epoch: state.epoch,
    }
  }
  if (state.status === 'cancelled') {
    return {
      status: 'cancelled',
      failure: {
        kind: 'cancelled',
        ...(terminal?.reason !== undefined
          ? { reason: terminal.reason }
          : state.saga.reason !== undefined
            ? { reason: state.saga.reason }
            : {}),
        ...(compensation !== undefined ? { compensation } : {}),
      },
      seq: state.seq,
      epoch: state.epoch,
    }
  }

  const primary = toStepFailure(state, terminal?.failure ?? state.failure, compensation)
  if (compensation?.outcome === 'failed' && compensation.failures.length > 0) {
    return {
      status: 'failed',
      failure: {
        kind: 'compensation',
        ...(primary !== undefined ? { cause: primary } : {}),
        compensation: { ...compensation, outcome: 'failed' },
      },
      seq: state.seq,
      epoch: state.epoch,
    }
  }
  if (primary !== undefined) {
    return { status: 'failed', failure: primary, seq: state.seq, epoch: state.epoch }
  }

  const failure = terminal?.failure ?? state.failure
  return {
    status: 'failed',
    failure: {
      kind: 'runtime',
      ...(failure?.step !== undefined ? { step: failure.step } : {}),
      error: failure?.error ?? {
        name: 'FlowFailure',
        message: `flow '${state.flow.name}' failed`,
        code: 'FLOW_FAILED',
      },
    },
    seq: state.seq,
    epoch: state.epoch,
  }
}

function toStepFailure(
  state: WizardState,
  source: FlowFailureState | undefined,
  compensation: RuntimeCompensationSummary | undefined,
): RuntimeStepFailure | undefined {
  const fallback = latestFailedStep(state)
  const failure = source ?? fallback
  if (failure === undefined || failure.step === undefined || failure.kind === 'runtime')
    return undefined
  const rec = state.steps[failure.step]
  const raw = failure.error as SerializedError & Partial<StepError>
  const error: StepError = {
    name: raw.name,
    message: raw.message,
    ...(raw.code !== undefined ? { code: raw.code } : {}),
    kind: failure.kind ?? raw.kind ?? 'run',
    at: failure.at ?? raw.at ?? state.updatedAt,
    ...(failure.attempt !== undefined
      ? { attempt: failure.attempt }
      : raw.attempt !== undefined
        ? { attempt: raw.attempt }
        : rec?.error?.attempt !== undefined
          ? { attempt: rec.error.attempt }
          : {}),
    ...(failure.issues !== undefined
      ? { issues: failure.issues }
      : raw.issues !== undefined
        ? { issues: raw.issues }
        : rec?.error?.issues !== undefined
          ? { issues: rec.error.issues }
          : {}),
    ...(failure.data !== undefined
      ? { data: failure.data }
      : raw.data !== undefined
        ? { data: raw.data }
        : rec?.error?.data !== undefined
          ? { data: rec.error.data }
          : {}),
  }
  return {
    kind: 'step',
    step: failure.step,
    error,
    ...(compensation !== undefined ? { compensation } : {}),
  }
}

function latestFailedStep(state: WizardState): FlowFailureState | undefined {
  let latest: { readonly id: string; readonly error: StepError } | undefined
  for (const [id, rec] of Object.entries(state.steps)) {
    if (rec.status !== 'failed' || rec.error === undefined) continue
    if (latest === undefined || rec.error.at >= latest.error.at) latest = { id, error: rec.error }
  }
  return latest === undefined ? undefined : { step: latest.id, error: latest.error }
}

function toCompensationSummary(
  state: WizardState,
  stored:
    | {
        readonly outcome: 'failed' | 'cancelled'
        readonly failures: readonly CompensationFailureState[]
      }
    | undefined,
): RuntimeCompensationSummary | undefined {
  if (stored !== undefined) return stored
  if (state.saga.outcome === undefined) return undefined
  return {
    outcome: state.saga.outcome,
    failures: state.saga.failures.map((ref) => {
      const error = state.steps[ref.step]?.error
      return {
        step: ref.step,
        runId: ref.runId,
        error:
          error === undefined
            ? {
                name: 'CompensationError',
                message: `compensation for '${ref.step}' failed`,
                code: 'COMPENSATION_FAILED',
              }
            : serialized(error),
      }
    }),
  }
}

function serialized(error: SerializedError): SerializedError {
  return {
    name: error.name,
    message: error.message,
    ...(error.code !== undefined ? { code: error.code } : {}),
  }
}

export function createTerminalResultTracker(args: {
  readonly getState: () => WizardState
  readonly notify: <T>(listeners: Set<(value: T) => void>, value: T) => void
}): TerminalResultTracker {
  const listeners = new Set<(result: RuntimeResult) => void>()
  const waiters = new Set<{
    readonly resolve: (result: RuntimeResult) => void
    readonly reject: (error: unknown) => void
  }>()
  let disposed = false
  let settledKey: string | undefined
  let cached: RuntimeResult | undefined

  const keyOf = (result: RuntimeResult): string => {
    return `${result.status}:${result.epoch}:${result.seq}`
  }
  const clear = (): void => {
    cached = undefined
    settledKey = undefined
  }
  const rejectAll = (error: RunLifecycleError): void => {
    for (const waiter of Array.from(waiters)) waiter.reject(error)
    waiters.clear()
  }
  const observe = (result: RuntimeResult): void => {
    const key = keyOf(result)
    if (key === settledKey) return
    settledKey = key
    cached = result
    for (const waiter of Array.from(waiters)) waiter.resolve(result)
    waiters.clear()
    args.notify(listeners, result)
  }

  return {
    current() {
      if (disposed) return undefined
      const result = deriveRuntimeResult(args.getState())
      if (result === undefined) {
        clear()
        return undefined
      }
      const key = keyOf(result)
      cached = result
      settledKey = key
      return cached
    },
    awaitResult() {
      if (disposed) return Promise.reject(new RunLifecycleError('RUN_DISPOSED'))
      const result = this.current()
      if (result !== undefined) return Promise.resolve(result)
      return new Promise<RuntimeResult>((resolve, reject) => {
        waiters.add({ resolve, reject })
      })
    },
    subscribe(listener) {
      if (disposed) throw new RunLifecycleError('RUN_DISPOSED')
      listeners.add(listener)
      const result = this.current()
      if (result !== undefined) args.notify(new Set([listener]), result)
      return () => listeners.delete(listener)
    },
    commit(state, batch) {
      if (disposed) return
      if (batch.some((event) => event.type === 'flow.reset')) {
        clear()
        rejectAll(new RunLifecycleError('RUN_RESET'))
      }
      const result = deriveRuntimeResult(state)
      if (result === undefined) {
        clear()
        return
      }
      observe(result)
    },
    dispose() {
      if (disposed) return
      disposed = true
      clear()
      rejectAll(new RunLifecycleError('RUN_DISPOSED'))
      listeners.clear()
    },
  }
}
