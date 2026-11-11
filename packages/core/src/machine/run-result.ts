/**
 * Run results derived from the stored state alone: the terminal result of a finished run
 * (`deriveRuntimeResult`) and the failure a halted run stopped on (`haltFailure`). Pure; the
 * runtime's result tracker, the child bridge and the outcome derivation all read these.
 *
 * @internal
 */

import { isTerminal } from './selectors'
import type {
  CompensationFailureState,
  CompensationOutcome,
  FlowFailureState,
  SerializedError,
  StepError,
  WizardState,
} from './state'

export interface RuntimeCompensationSummary {
  readonly outcome: CompensationOutcome
  readonly failures: readonly CompensationFailureState[]
}

export type RuntimeStepFailure = {
  readonly kind: 'step'
  readonly step: string
  readonly error: StepError
  readonly compensation?: RuntimeCompensationSummary
  /** A failed flow step's terminal child result (D13), or the halted child a halted run waits on. */
  readonly child?: RuntimeResult | RuntimeHalt
}

/** A run stopped by a failed step (or by a halted child) that recovery commands can resume. */
export interface RuntimeHalt {
  readonly status: 'halted'
  readonly failure: RuntimeStepFailure
  readonly seq: number
  readonly epoch: number
}

/** The terminal result of a flow step's live child, if it has one. */
export type ChildResultOf = (step: string) => RuntimeResult | undefined

export type RuntimeFailure =
  | RuntimeStepFailure
  | {
      readonly kind: 'compensation'
      readonly cause?: RuntimeStepFailure
      readonly compensation: RuntimeCompensationSummary & { readonly outcome: 'partial' }
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

/** The terminal result of `state`, or `undefined` while the run is not terminal. */
export function deriveRuntimeResult(
  state: WizardState,
  childResult?: ChildResultOf,
): RuntimeResult | undefined {
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

  const primary = toStepFailure(
    state,
    terminal?.failure ?? state.failure,
    compensation,
    childResult,
  )
  if (compensation?.outcome === 'partial') {
    return {
      status: 'failed',
      failure: {
        kind: 'compensation',
        ...(primary !== undefined ? { cause: primary } : {}),
        compensation: { ...compensation, outcome: 'partial' },
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

/** The failed step a halted run stopped on, if one of its own steps failed. */
export function haltFailure(state: WizardState): RuntimeStepFailure | undefined {
  return toStepFailure(state, state.failure, undefined, undefined)
}

function toStepFailure(
  state: WizardState,
  source: FlowFailureState | undefined,
  compensation: RuntimeCompensationSummary | undefined,
  childResult: ChildResultOf | undefined,
): RuntimeStepFailure | undefined {
  const failure = source ?? latestFailedStep(state)
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
  const child = rec?.kind === 'flow' ? childResult?.(failure.step) : undefined
  return {
    kind: 'step',
    step: failure.step,
    error,
    ...(compensation !== undefined ? { compensation } : {}),
    ...(child !== undefined ? { child } : {}),
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
  stored: RuntimeCompensationSummary | undefined,
): RuntimeCompensationSummary | undefined {
  if (stored !== undefined) return stored
  if (state.saga.outcome === undefined) return undefined
  return {
    outcome: state.saga.failures.length > 0 ? 'partial' : 'completed',
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
