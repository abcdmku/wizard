/**
 * Assembly validates each property against the actual steps map, preserving local diagnostics.
 * Identical structural twins and duplicate step objects are distinguished at runtime only.
 * Reusable step modules keep reference parameters generic (`L extends AnyStep`).
 * @packageDocumentation
 */

export type { CheckSteps } from './assembly'
export * from './boundary'
export * from './extractors'
export * from './handlers'
export * from './hook-args'
export * from './primitives'
export * from './step'
export * from './step-api'
export * from './step-config'
export type { NeedRef, NeedsOutput, NeedsSpec } from './step-inference'
export type { StepRecordConfig } from './step-record'
export * from './wizard'
