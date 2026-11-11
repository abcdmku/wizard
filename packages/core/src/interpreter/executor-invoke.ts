/** Resolve and invoke compiled hooks, including their output boundaries. @internal */

import type { CompiledStep, CompiledWizard, HookArgs } from '../authoring/compiled'
import type { HookName } from '../machine/commands'
import type { StepRecord } from '../machine/state'
import { snapshotEach } from './each'
import { codedError, unwrapBoundary } from './errors'
import { resolveRunOutput } from './executor-run'
import { chain } from './thenable'

export function invoke(
  hookName: HookName,
  stepDef: CompiledStep,
  rec: StepRecord | undefined,
  args: HookArgs,
): unknown {
  switch (hookName) {
    case 'parseInput': {
      const boundary = stepDef.input
      if (boundary === undefined) return rec?.input
      return chain(boundary.parse(rec?.input), (result) => unwrapBoundary(result, 'input'))
    }
    case 'run': {
      const hook = stepDef.hooks.run
      if (hook === undefined) throw missingHook(stepDef.id, 'run')
      return resolveRunOutput(hook(args), stepDef, args)
    }
    case 'each': {
      if (stepDef.each === undefined) throw missingHook(stepDef.id, 'each')
      return snapshotEach(stepDef, args)
    }
    case 'sleep': {
      const sleep = stepDef.sleep
      if (sleep === undefined) throw missingHook(stepDef.id, 'sleep')
      return typeof sleep === 'function' ? sleep(args) : sleep
    }
    case 'on': {
      const event = typeof args.event === 'string' ? args.event : undefined
      const hook =
        event === undefined
          ? undefined
          : (stepDef.hooks.waitFor?.[event] ?? stepDef.hooks.on?.[event])
      if (typeof hook !== 'function') throw missingHook(stepDef.id, `on[${String(event)}]`)
      return hook(args)
    }
    case 'wizardOn':
      throw missingHook(stepDef.id, 'wizardOn')
    case 'childContext': {
      // The child's context is a data door: the mapped value goes through the
      // child wizard's context boundary before `child.create` can see it.
      const hook = stepDef.hooks.childContext
      if (hook === undefined) throw missingHook(stepDef.id, 'childContext')
      const value = hook(args)
      const boundary = stepDef.child?.context
      if (boundary === undefined) return value
      return chain(value, (v) =>
        chain(boundary.parse(v), (result) => unwrapBoundary(result, 'child context')),
      )
    }
    default: {
      const hook = stepDef.hooks[hookName]
      if (hook === undefined) throw missingHook(stepDef.id, hookName)
      return hook(args)
    }
  }
}

/** The wizard-level `on[extra.event]` handler (`CompiledWizard.on`). */
export function invokeWizardOn(def: CompiledWizard, args: HookArgs): unknown {
  const event = typeof args.event === 'string' ? args.event : undefined
  const hook = event === undefined ? undefined : def.on?.[event]
  if (hook === undefined) {
    throw codedError(
      'HookMissingError',
      'HOOK_MISSING',
      `wizard '${def.name}' has no 'on[${String(event)}]' handler`,
    )
  }
  return hook(args)
}

/**
 * The step's `retry.when` rejects retrying after `error` (the `mapError` value when the step
 * maps errors, else the run adapter's mapped data or the raw thrown value). A throwing predicate
 * rejects too.
 */
export function retryRejected(def: CompiledWizard, step: string, error: unknown): boolean {
  const when = (def.steps[step]?.retry ?? def.policies.retry)?.when
  if (when === undefined) return false
  try {
    return !when(error)
  } catch {
    return true
  }
}

function missingHook(step: string, hook: string): Error {
  return codedError('HookMissingError', 'HOOK_MISSING', `step '${step}' has no '${hook}' hook`)
}

export function noop(): void {}
