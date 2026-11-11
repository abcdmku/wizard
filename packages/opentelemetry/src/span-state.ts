import {
  type Context,
  isSpanContextValid,
  type Span,
  type SpanContext,
  trace,
} from '@opentelemetry/api'

export interface EventRecord {
  readonly type: string
  readonly path?: readonly string[]
  readonly seq?: number
  readonly at?: number
  readonly causedBy?: number
  readonly [key: string]: unknown
}

export interface FlowRecord {
  readonly path: readonly string[]
  readonly span: Span
  readonly spanContext: Context
  ended: boolean
}

export interface AttemptRecord {
  readonly key: string
  readonly path: readonly string[]
  readonly step: string
  readonly runId: number
  readonly attempt: number
  readonly span: Span
  readonly spanContext: Context
  closed: boolean
}

export interface CompensationRecord {
  readonly key: string
  readonly path: readonly string[]
  readonly step: string
  readonly runId?: number
  readonly span: Span
  closed: boolean
}

export interface CompletedAttempt {
  readonly path: readonly string[]
  readonly step: string
  readonly runId: number
  readonly spanContext: SpanContext
}

export type Outcome = 'success' | 'error' | 'cancelled' | 'detached' | 'reset' | 'interrupted'

export const pathKey = (path: readonly string[]): string => JSON.stringify(path)

export const asPath = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((segment): segment is string => typeof segment === 'string')
}

export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

export const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export const isContext = (value: Context | SpanContext): value is Context =>
  typeof value === 'object' && value !== null && 'getValue' in value

export const spanContextOf = (
  value: Context | SpanContext | undefined,
): SpanContext | undefined => {
  if (!value) return undefined
  const candidate = isContext(value) ? trace.getSpanContext(value) : value
  return candidate && isSpanContextValid(candidate) ? candidate : undefined
}

export const safeOutcome = (value: unknown): 'failed' | 'cancelled' | undefined => {
  if (value === 'failed' || value === 'cancelled') return value
  return undefined
}

export const isUnderPath = (candidate: readonly string[], parent: readonly string[]): boolean =>
  candidate.length >= parent.length &&
  parent.every((segment, index) => candidate[index] === segment)
