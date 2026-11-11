/**
 * Option normalisation shared by the create and resume doors, and the machine environment of one
 * runtime instance.
 *
 * @internal
 */

import type { CompiledFlow } from '../../authoring/compiled'
import { parseDuration } from '../../authoring/duration'
import { describeError, WizardError } from '../../errors'
import {
  type Clock,
  createIdGenerator,
  createRealClock,
  createRealScheduler,
  type RuntimeEnv,
} from '../../interpreter/env'
import { DEFAULT_EVENT_IDS } from '../../machine/event-ids'
import type { EventIdPolicy, MachineEnv } from '../../machine/types'
import type {
  EventIdOptions,
  RestoreChild,
  ResumeWizardRuntimeOptions,
  RuntimeConfig,
} from './types'

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
    beforeEffects: opts.beforeEffects,
    beforeTimer: opts.beforeTimer,
    onListenerError: opts.onListenerError,
    eventIds: opts.eventIds === undefined ? undefined : eventIdPolicy(opts.eventIds),
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

/** `RunOptions.eventIds` in ms; an invalid window is a programmer error (`DEFINITION_INVALID`). */
function eventIdPolicy(options: EventIdOptions): EventIdPolicy {
  const limit = options.limit ?? DEFAULT_EVENT_IDS.limit
  if (!Number.isInteger(limit) || limit < 1) {
    throw new WizardError(
      'DEFINITION_INVALID',
      `eventIds.limit must be a positive integer, got ${String(limit)}`,
    )
  }
  try {
    return {
      ttlMs: options.ttl === undefined ? DEFAULT_EVENT_IDS.ttlMs : parseDuration(options.ttl),
      limit,
    }
  } catch (error) {
    throw new WizardError('DEFINITION_INVALID', `eventIds.ttl: ${describeError(error)}`)
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
