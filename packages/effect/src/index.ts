/**
 * Effect 3.22.1 integration for OpenWizard task steps and terminal runs.
 *
 * v4 RC is intentionally not supported by this package. The v4 Cause and
 * runtime declarations are different; a future major or prerelease adapter
 * will carry that compatibility explicitly.
 *
 * @packageDocumentation
 */

export { awaitResult, execute } from './execute'
export {
  type EffectRunner,
  type EffectRunnerOptions,
  type EffectTaskOptions,
  type EffectTraceOptions,
  makeEffectRunner,
} from './runner'
