import type { Clock, Scheduler } from '@openwizard/core'
import type { Clock as EffectClock } from 'effect'

export function makeWizardClock(clock: EffectClock.Clock): Clock {
  return { now: () => clock.currentTimeMillisUnsafe() }
}

export function makeWizardScheduler(): Scheduler {
  let nextId = 0
  const handles = new Map<number, ReturnType<typeof setTimeout>>()
  return {
    setTimeout: (run, delay) => {
      nextId += 1
      const id = nextId
      handles.set(
        id,
        setTimeout(() => {
          handles.delete(id)
          run()
        }, delay),
      )
      return id
    },
    clearTimeout: (handle) => {
      if (typeof handle !== 'number') return
      const timer = handles.get(handle)
      if (timer !== undefined) clearTimeout(timer)
      handles.delete(handle)
    },
  }
}
