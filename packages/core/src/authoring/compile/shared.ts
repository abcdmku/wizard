/**
 * Small helpers shared by the compiler modules.
 * @internal
 */

import type { CompiledStep, RuntimeBoundary } from '../compiled'
import type { AnyStep, StepKind } from '../types'

export type Rec = Record<string, unknown>
export type Mutable<T> = { -readonly [K in keyof T]: T[K] }

export function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const KINDS: ReadonlySet<string> = new Set<StepKind>([
  'view',
  'task',
  'wait',
  'decision',
  'flow',
  'final',
])

export function isStepRecord(value: unknown): value is AnyStep {
  return isRecord(value) && typeof value.kind === 'string' && KINDS.has(value.kind)
}

export function describeName(flow: unknown): string {
  return isRecord(flow) && typeof flow.name === 'string' ? flow.name : '<unnamed>'
}

export const DEFAULT_TTL_MS = 300_000
export const NO_EXPOSE: CompiledStep['expose'] = { input: false, output: false }

export function trustedBoundary(): RuntimeBoundary {
  return { kind: 'trusted', parse: (value) => ({ ok: true, value }) }
}

/** Maximum nesting depth (path length of the deepest child); mirrors the child bridge. */
export const MAX_DEPTH = 8
