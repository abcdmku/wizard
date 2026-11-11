/** Shared hook fields and event handler validation. @internal */
import type { OnHandlerResult } from '../compiled'
import { asHook, hookField } from './hooks'
import { isRecord, type Rec } from './shared'
import type { Problem, StepBuild, StepCtx, StepHooks } from './steps'

export function compileStepHooks(
  c: Rec,
  step: StepBuild,
  hooks: StepHooks,
  problem: Problem,
  sc: StepCtx,
): void {
  hookField(c.enter, 'enter', problem, (h) => {
    hooks.enter = asHook<void>(h)
  })
  hookField(c.exit, 'exit', problem, (h) => {
    hooks.exit = asHook<void>(h)
  })
  hookField(c.when, 'when', problem, (h) => {
    hooks.when = asHook<boolean>(h)
  })
  if (step.kind === 'view') {
    hookField(c.canEnter, 'canEnter', problem, (h) => {
      hooks.canEnter = asHook<boolean>(h)
    })
    hookField(c.canExit, 'canExit', problem, (h) => {
      hooks.canExit = asHook<boolean>(h)
    })
  }
  if (c.on !== undefined) hooks.on = eventHandlers(c.on, 'on', problem, sc)
}

export function eventHandlers(
  raw: unknown,
  field: 'on' | 'waitFor',
  problem: Problem,
  sc: StepCtx,
): Record<string, import('../compiled').Hook<OnHandlerResult>> {
  const handlers: Record<string, import('../compiled').Hook<OnHandlerResult>> = Object.create(null)
  if (!isRecord(raw)) problem(`'${field}' must be an object of event handlers`)
  else {
    for (const [event, handler] of Object.entries(raw)) {
      if (handler === undefined) continue
      if (!sc.events.has(event))
        problem(`${field}['${event}']: the wizard declares no event '${event}'`)
      if (typeof handler !== 'function') {
        problem(`${field}['${event}'] must be a function`)
        continue
      }
      handlers[event] = asHook<OnHandlerResult>(handler as (args: never) => unknown)
    }
  }
  if (field === 'waitFor' && Object.keys(handlers).length === 0)
    problem("'waitFor' must contain at least one event handler")
  return handlers
}
