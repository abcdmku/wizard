import { afterEach, expect, it, vi } from 'vitest'
import { createDevClock } from '../src/server/clock'

afterEach(() => vi.useRealTimers())

it('skip fires the earliest timer now and moves the clock to its deadline', () => {
  vi.useFakeTimers()
  const clock = createDevClock()
  const fired: string[] = []
  const start = clock.now()
  clock.setTimeout(() => fired.push('hour'), 3_600_000)
  clock.setTimeout(() => fired.push('minute'), 60_000)

  expect(clock.next()).toBe(start + 60_000)
  expect(clock.skip()).toBe(true)
  expect(fired).toEqual(['minute'])
  expect(clock.now()).toBe(start + 60_000)

  // The hour timer is 59 minutes away by the clock, and by the wall clock too.
  vi.advanceTimersByTime(59 * 60_000 - 1)
  expect(fired).toEqual(['minute'])
  vi.advanceTimersByTime(1)
  expect(fired).toEqual(['minute', 'hour'])
  expect(clock.skip()).toBe(false)
})

it('a cleared timer never fires', () => {
  vi.useFakeTimers()
  const clock = createDevClock()
  const fired: string[] = []
  const handle = clock.setTimeout(() => fired.push('x'), 10)
  clock.clearTimeout(handle)
  vi.advanceTimersByTime(100)
  expect(fired).toEqual([])
  expect(clock.next()).toBeUndefined()
})
