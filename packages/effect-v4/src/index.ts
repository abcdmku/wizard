/**
 * Effect 4 beta integration for OpenWizard task steps and terminal runs.
 *
 * This package intentionally tracks one exact Effect beta and may ship
 * breaking prereleases as Effect v4 changes.
 *
 * @packageDocumentation
 */

export { awaitResult, execute } from './execute'
export {
  type EffectV4Runner,
  type EffectV4RunnerOptions,
  type EffectV4TaskOptions,
  type EffectV4TraceOptions,
  makeEffectV4Runner,
} from './runner'
