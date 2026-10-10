/**
 * Option normalisation shared by the create and resume doors, and the machine environment of one
 * runtime instance.
 *
 * @internal
 */

import type { CompiledFlow } from '../../authoring/compiled'
import {
  type Clock,
  createIdGenerator,
  createRealClock,
  createRealScheduler,
  type RuntimeEnv,
} from '../../interpreter/env'
import type { MachineEnv } from '../../machine/types'
import type { RestoreChild, ResumeWizardRuntimeOptions, RuntimeConfig } from './types'

export function toConfig(opts: ResumeWizardRuntimeOptions, restore: RestoreChild): RuntimeConfig {
  const scheduler = opts.scheduler ?? createRealScheduler()
  const clock = opts.clock ?? (isClock(scheduler) ? scheduler : createRealClock())
  return {
    machine: opts.machine,
    initialState: opts.initialState,
    env: { clock, scheduler, ids: opts.ids ?? createIdGenerator() },
    deps: opts.deps,
    strict: opts.strict,
    logSize: opts.logSize,
    abortGraceMs: opts.abortGraceMs,
    onListenerError: opts.onListenerError,
    persistence:
      opts.store === undefined
        ? undefined
        : {
            store: opts.store,
            key: opts.key,
            autoSave: opts.autoSave ?? 'change',
            debounceMs: opts.debounceMs ?? 0,
            redact: opts.redact,
            clearOnDone: opts.clearOnDone,
            onError: opts.onPersistError,
          },
    restore,
  }
}

function isClock(value: object): value is Clock & object {
  return 'now' in value && typeof value.now === 'function'
}

export function machineEnv(
  def: CompiledFlow,
  path: readonly string[],
  env: RuntimeEnv,
): MachineEnv {
  return { def, path, now: () => env.clock.now(), id: (prefix) => env.ids.id(prefix) }
}
