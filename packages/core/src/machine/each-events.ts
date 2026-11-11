/** Durable map execution facts. Progress is emitted separately by the interpreter. */

import type { StepFailureKind } from './event-lifecycle'
import type { ChildSummary, SerializedError } from './state'

export type EachEventBody =
  | {
      readonly type: 'step.eachStarted'
      readonly step: string
      readonly items: readonly unknown[]
      readonly keys: readonly string[]
    }
  | {
      readonly type: 'step.eachItemStarted'
      readonly step: string
      readonly index: number
      readonly attempt: number
      readonly resumed?: boolean
    }
  | {
      readonly type: 'step.eachItemKeyed'
      readonly step: string
      readonly index: number
      readonly key: string
    }
  | {
      readonly type: 'step.eachItemCompleted'
      readonly step: string
      readonly index: number
      readonly output?: unknown
    }
  | {
      readonly type: 'step.eachItemFailed'
      readonly step: string
      readonly index: number
      readonly attempt: number
      readonly error: SerializedError
      readonly willRetry: boolean
      readonly kind?: StepFailureKind
      readonly data?: unknown
    }
  | {
      readonly type: 'step.eachRetryScheduled'
      readonly step: string
      readonly index: number
      readonly attempt: number
      readonly dueAt: number
      readonly timerId: string
    }
  | {
      readonly type: 'step.eachRetryRequested'
      readonly step: string
      readonly indices: readonly number[]
      readonly resetAttempts?: boolean
    }
  | {
      readonly type: 'step.eachChildStarted'
      readonly step: string
      readonly index: number
      readonly context: unknown
    }
  | {
      readonly type: 'step.eachChildSummary'
      readonly step: string
      readonly index: number
      readonly summary: ChildSummary
    }
  | {
      readonly type: 'step.eachChildOutputRequested'
      readonly step: string
      readonly index: number
      readonly output?: unknown
    }
  | {
      readonly type: 'step.eachMapErrorStarted'
      readonly step: string
      readonly index: number
      readonly attempt: number
      readonly error: SerializedError
      readonly timedOut?: boolean
      readonly syncViolation?: boolean
      readonly failureKind?: 'typed' | 'defect' | 'interrupted'
    }
