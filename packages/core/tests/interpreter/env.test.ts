import { describe, expect, it } from 'vitest'
import {
  createIdGenerator,
  createRealScheduler,
  createSequentialIds,
} from '../../src/interpreter/env'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createTimerRegistry } from '../../src/interpreter/timers'

describe('createTestScheduler', () => {
  it('fires timers in due order as virtual time advances, updating now() as it goes', () => {
    const s = createTestScheduler({ now: 10 })
    const log: string[] = []
    s.setTimeout(() => log.push(`b@${s.now()}`), 20)
    s.setTimeout(() => log.push(`a@${s.now()}`), 5)
    s.setTimeout(() => log.push(`c@${s.now()}`), 20)
    expect(s.pending()).toBe(3)
    s.advance(4)
    expect(log).toEqual([])
    s.advance(1)
    expect(log).toEqual(['a@15'])
    s.advance(100)
    expect(log).toEqual(['a@15', 'b@30', 'c@30'])
    expect(s.now()).toBe(115)
    expect(s.pending()).toBe(0)
  })

  it('runs timers scheduled by timers when they fall inside the advanced window; clearTimeout removes', () => {
    const s = createTestScheduler()
    const log: number[] = []
    s.setTimeout(() => {
      log.push(1)
      s.setTimeout(() => log.push(2), 5)
    }, 5)
    const h = s.setTimeout(() => log.push(99), 7)
    s.clearTimeout(h)
    s.advance(10)
    expect(log).toEqual([1, 2])
  })

  it('flush() fires everything regardless of due time', () => {
    const s = createTestScheduler()
    const log: number[] = []
    s.setTimeout(() => log.push(1), 1_000_000)
    s.setTimeout(() => log.push(2), 1)
    s.flush()
    expect(log).toEqual([2, 1])
    expect(s.now()).toBe(1_000_000)
  })
})

describe('id generators', () => {
  it('sequential ids count per prefix; real ids are unique', () => {
    const ids = createSequentialIds()
    expect([ids.id('tx'), ids.id('fx'), ids.id('tx')]).toEqual(['tx_1', 'fx_1', 'tx_2'])
    const real = createIdGenerator()
    const set = new Set(Array.from({ length: 200 }, () => real.id('x')))
    expect(set.size).toBe(200)
    expect(real.id('wiz').startsWith('wiz_')).toBe(true)
  })
})

describe('createRealScheduler', () => {
  it('schedules and cancels through the platform setTimeout', async () => {
    const s = createRealScheduler()
    const fired: string[] = []
    const h = s.setTimeout(() => fired.push('cancelled'), 1)
    s.clearTimeout(h)
    s.setTimeout(() => fired.push('ok'), 1)
    await new Promise((r) => setTimeout(r, 20))
    expect(fired).toEqual(['ok'])
  })
})

describe('createTimerRegistry', () => {
  it('arms by absolute time, replaces on re-set, clears by id and clearAll', () => {
    const s = createTestScheduler({ now: 100 })
    const timers = createTimerRegistry({ clock: s, scheduler: s })
    const log: string[] = []
    timers.set('a', 150, () => log.push('a'))
    timers.set('a', 200, () => log.push('a2')) // replaces
    timers.set('b', 120, () => log.push('b'))
    timers.set('past', 50, () => log.push('past')) // already due → next tick
    expect(timers.size()).toBe(3)
    expect(timers.has('a')).toBe(true)
    s.advance(0)
    expect(log).toEqual(['past'])
    s.advance(50)
    expect(log).toEqual(['past', 'b'])
    timers.clear('a')
    s.advance(100)
    expect(log).toEqual(['past', 'b'])
    timers.set('c', 400, () => log.push('c'))
    timers.clearAll()
    expect(timers.size()).toBe(0)
    s.flush()
    expect(log).toEqual(['past', 'b'])
  })
})
