import { describe, expect, it } from 'vitest'
import { eachItem } from '../../src/machine/each-state'
import { flow, flowStep, runStep, view } from '../helpers/fixtures'
import { e2e, e2eResume, roundTrip, tick } from '../wizard/e2e/harness'

describe('mapped child flows with the real machine', () => {
  it('selects exact keys locally and delivers flat indexed wire paths to one nested child', async () => {
    const leaf = flow({
      name: 'selected-leaf',
      start: 'form',
      steps: {
        form: view({ next: 'done' }),
        done: runStep({ run: ({ context }) => context }),
      },
    })
    const child = flow({
      name: 'selected-parent',
      start: 'nested',
      steps: { nested: flowStep(leaf, { context: ({ context }) => context }) },
    })
    const def = flow({
      name: 'selected-map',
      start: 'orders',
      steps: {
        orders: flowStep(child, {
          each: {
            items: () => ['alpha', '0', 'named'],
            key: (item) => String(item),
            concurrency: 3,
          },
          context: ({ item }) => item,
        }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    const first = t.run.child('orders', 0)
    const second = t.run.child('orders', '0')
    expect(first).toBe(t.run.child('orders', 'alpha'))
    expect(second).toBe(t.run.child('orders', 1))
    expect(first).not.toBe(second)
    expect(first.getState().context).toBe('alpha')
    expect(second.getState().context).toBe('0')
    expect(
      await t.run.dispatch({
        type: 'child',
        path: ['orders', '0', 'nested'],
        command: { type: 'next' },
      }),
    ).toMatchObject({ ok: true })
    expect(first.getState()).toMatchObject({ status: 'done', output: 'alpha' })
    expect(second.getState().status).toBe('waiting')
    expect(
      await t.run.dispatch({
        type: 'child',
        path: ['orders', 'named', 'nested'],
        command: { type: 'next' },
      }),
    ).toMatchObject({ ok: true })
    expect(eachItem(t.rec('orders')!.each!, 2).status).toBe('done')
    expect(second.getState().status).toBe('waiting')
    expect(await second.child('nested').next()).toMatchObject({ ok: true })
    expect(t.run.getState()).toMatchObject({ status: 'done', output: ['alpha', '0', 'named'] })
    t.run.dispose()
    expect(t.run.child('orders', 0)).toBe(first)
    expect(t.run.child('orders', '0')).toBe(second)
    expect(first.isDisposed()).toBe(true)
    expect(second.isDisposed()).toBe(true)
  })

  it('maps item context and deps, limits child concurrency, and returns ordered mapped outputs', async () => {
    const items = ['first/a', 'second', 'third']
    const started: number[] = []
    const received: unknown[] = []
    const pending = new Map<number, () => void>()
    let active = 0
    let maximum = 0
    const child = flow({
      name: 'mapped-child',
      start: 'work',
      steps: {
        work: runStep({
          run({ context, deps }) {
            const data = context as { item: string; index: number; tenant: string }
            received.push({ context, deps })
            started.push(data.index)
            active++
            maximum = Math.max(maximum, active)
            return new Promise<string>((resolve) => {
              pending.set(data.index, () => {
                active--
                resolve(`child:${data.item}`)
              })
            })
          },
        }),
      },
    })
    const def = flow({
      name: 'mapped-parent',
      start: 'orders',
      steps: {
        orders: flowStep(child, {
          each: { items: () => items, key: (item) => String(item), concurrency: 2 },
          context: ({ context, item, index }) => ({ ...Object(context), item, index }),
          deps: ({ deps, item, index }) => ({ ...Object(deps), item, index }),
          output: ({ item, index, output }) => ({ item, index, output }),
        }),
      },
    })
    const t = e2e(def, { context: { tenant: 'acme' }, deps: { service: 'orders' } })
    await t.run.start()
    expect(started).toEqual([0, 1])
    pending.get(1)?.()
    await tick(10)
    expect(started).toEqual([0, 1, 2])
    pending.get(2)?.()
    pending.get(0)?.()
    await tick(10)
    expect(maximum).toBe(2)
    expect(received).toEqual(
      items.map((item, index) => ({
        context: { tenant: 'acme', item, index },
        deps: { service: 'orders', item, index },
      })),
    )
    expect(t.run.getState()).toMatchObject({
      status: 'done',
      output: items.map((item, index) => ({ item, index, output: `child:${item}` })),
    })
    const paths = t.of('run.started').filter((event) => event.path.length > 0)
    expect(paths.map((event) => event.path)).toEqual([
      ['orders', '0'],
      ['orders', '1'],
      ['orders', '2'],
    ])
    expect(Object.keys(t.run.getSnapshot().children)).toHaveLength(3)
    t.run.dispose()
  })

  it('retains completed child outputs and recreates only a failed item on manual retry', async () => {
    const attempts = new Map<number, number>()
    const child = flow({
      name: 'sometimes-failing-child',
      start: 'work',
      steps: {
        work: runStep({
          run({ context }) {
            const index = Number(context)
            const attempt = (attempts.get(index) ?? 0) + 1
            attempts.set(index, attempt)
            if (index === 2 && attempt === 1) throw new Error('item two failed')
            return `finished:${index}`
          },
        }),
      },
    })
    const def = flow({
      name: 'recoverable-child-map',
      start: 'orders',
      steps: {
        orders: flowStep(child, {
          each: { items: () => [0, 1, 2], concurrency: 3 },
          context: ({ item }) => item,
        }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    expect(t.run.getState().status).toBe('halted')
    expect(eachItem(t.rec('orders')!.each!, 0)).toMatchObject({
      status: 'done',
      output: 'finished:0',
    })
    expect(eachItem(t.rec('orders')!.each!, 1)).toMatchObject({
      status: 'done',
      output: 'finished:1',
    })
    expect(eachItem(t.rec('orders')!.each!, 2).status).toBe('failed')
    expect(await t.run.retry('orders')).toMatchObject({ ok: true })
    await tick(10)
    expect(t.run.getState()).toMatchObject({
      status: 'done',
      output: ['finished:0', 'finished:1', 'finished:2'],
    })
    expect([...attempts]).toEqual([
      [0, 1],
      [1, 1],
      [2, 2],
    ])
    expect(eachItem(t.rec('orders')!.each!, 2)).toMatchObject({ attempt: 1, generation: 1 })
    t.run.dispose()
  })

  it('applies the map retry policy to child failures without rerunning finished siblings', async () => {
    const attempts = new Map<number, number>()
    const child = flow({
      name: 'retrying-child',
      start: 'work',
      steps: {
        work: runStep({
          run({ context }) {
            const index = Number(context)
            const attempt = (attempts.get(index) ?? 0) + 1
            attempts.set(index, attempt)
            if (index === 1 && attempt === 1) throw new Error('try another child')
            return index
          },
        }),
      },
    })
    const def = flow({
      name: 'retry-child-map',
      start: 'orders',
      steps: {
        orders: {
          ...flowStep(child, {
            each: { items: () => [0, 1, 2], concurrency: 2 },
            context: ({ item }) => item,
          }),
          retry: { retries: 1, backoff: 10 },
        },
      },
    })
    const t = e2e(def)
    await t.run.start()
    expect(eachItem(t.rec('orders')!.each!, 1)).toMatchObject({ status: 'retrying', attempt: 1 })
    expect(t.run.getState().timers['each-retry:orders:1']).toMatchObject({ at: 10_010 })
    t.sched.advance(10)
    await tick(10)
    expect(t.run.getState()).toMatchObject({ status: 'done', output: [0, 1, 2] })
    expect([...attempts]).toEqual([
      [0, 1],
      [1, 2],
      [2, 1],
    ])
    t.run.dispose()
  })

  it('resumes unfinished children while retaining finished outputs and the snapshotted source', async () => {
    const calls = new Map<number, number>()
    let sourceCalls = 0
    const child = flow({
      name: 'resumable-child',
      start: 'work',
      steps: {
        work: runStep({
          idempotent: true,
          run({ context }) {
            const index = Number(context)
            const call = (calls.get(index) ?? 0) + 1
            calls.set(index, call)
            return index === 1 && call === 1 ? new Promise(() => {}) : `finished:${index}`
          },
        }),
      },
    })
    const def = flow({
      name: 'resuming-child-map',
      start: 'orders',
      steps: {
        orders: flowStep(child, {
          each: {
            items: () => {
              sourceCalls++
              return [0, 1]
            },
            concurrency: 2,
          },
          context: ({ item }) => item,
        }),
      },
    })
    const a = e2e(def)
    await a.run.start()
    const saved = roundTrip(a.run.getSnapshot())
    a.run.dispose()
    const b = e2eResume(def, saved)
    await tick(10)
    expect(b.run.getState()).toMatchObject({ status: 'done', output: ['finished:0', 'finished:1'] })
    expect([...calls]).toEqual([
      [0, 1],
      [1, 2],
    ])
    expect(sourceCalls).toBe(1)
    b.run.dispose()
  })

  it('resumes the output mapper after its child finished without restarting the child', async () => {
    let childCalls = 0
    const mapped: unknown[] = []
    const child = flow({
      name: 'finished-child',
      start: 'work',
      steps: {
        work: runStep({
          run: () => {
            childCalls++
            return { childValue: 42 }
          },
        }),
      },
    })
    const def = flow({
      name: 'resume-child-output-map',
      start: 'orders',
      steps: {
        orders: flowStep(child, {
          each: { items: () => ['order'], concurrency: 1 },
          context: ({ item }) => ({ item }),
          output(args) {
            mapped.push({ item: args.item, index: args.index, output: args.output })
            return mapped.length === 1 ? new Promise(() => {}) : { mappedValue: args.output }
          },
        }),
      },
    })
    const a = e2e(def)
    await a.run.start()
    expect(eachItem(a.rec('orders')!.each!, 0)).toMatchObject({
      status: 'running',
      child: { status: 'done' },
      output: { childValue: 42 },
    })
    const saved = roundTrip(a.run.getSnapshot())
    a.run.dispose()
    const b = e2eResume(def, saved)
    await tick(10)
    expect(b.run.getState()).toMatchObject({
      status: 'done',
      output: [{ mappedValue: { childValue: 42 } }],
    })
    expect(childCalls).toBe(1)
    expect(mapped).toEqual([
      { item: 'order', index: 0, output: { childValue: 42 } },
      { item: 'order', index: 0, output: { childValue: 42 } },
    ])
    b.run.dispose()
  })
})
