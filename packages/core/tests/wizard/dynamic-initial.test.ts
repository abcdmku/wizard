import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { defineWizard } from '../../src/wizard/define-wizard'

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function containsFunction(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === 'function') return true
  if (typeof value !== 'object' || value === null || seen.has(value)) return false
  seen.add(value)
  return Object.values(value).some((item) => containsFunction(item, seen))
}

describe('dynamic view initial', () => {
  it('fails the entered view as a hook failure when the initializer rejects', async () => {
    const flow = defineWizard(
      { name: 'initial-failure', context: boundary.trusted<{}>() },
      ({ view, steps }) =>
        steps({
          form: view({
            next: null,
            input: boundary.trusted<{ name: string }>(),
            initial: async () => {
              throw new Error('defaults unavailable')
            },
          }),
        }),
    )
    const run = flow.create({})

    await run.start()
    await flush()

    expect(run.getState().steps.form).toMatchObject({
      status: 'failed',
      error: { kind: 'hook', message: 'defaults unavailable' },
    })
    expect(run.getState().status).toBe('halted')
    expect(run.log().some((event) => event.type === 'step.failed')).toBe(true)

    const resumed = flow.resume(run.getSnapshot())
    expect(resumed.getState().steps.form).toMatchObject({
      status: 'failed',
      error: { kind: 'hook', message: 'defaults unavailable' },
    })
  })

  it('runs before enter and persists only the resolved draft', async () => {
    const order: string[] = []
    const flow = defineWizard(
      {
        name: 'initial-order',
        context: boundary.trusted<{ accountId: string }>(),
        deps: boundary.trusted<{ prefix: string }>(),
      },
      ({ view, steps }) =>
        steps({
          form: view({
            next: null,
            input: boundary.trusted<{ name: string }>(),
            initial: ({ context, deps }) => {
              order.push('initial')
              return { name: `${deps.prefix}-${context.accountId}` }
            },
            enter: () => order.push('enter'),
          }),
        }),
    )
    const run = flow.create(
      { accountId: 'acct' },
      {
        deps: { prefix: 'new' },
      },
    )

    await run.start()

    expect(order).toEqual(['initial', 'enter'])
    expect(run.getState().steps.form?.input).toEqual({ name: 'new-acct' })
    expect(containsFunction(run.log())).toBe(false)
    expect(containsFunction(run.getSnapshot())).toBe(false)
  })

  it('initializes before enter on the scheduler path after a step', async () => {
    const order: string[] = []
    const flow = defineWizard(
      { name: 'initial-scheduler', context: boundary.trusted<{}>() },
      ({ step, view, steps }) =>
        steps({
          prepare: step({ run: () => order.push('task'), next: 'form' }),
          form: view({
            next: null,
            input: boundary.trusted<{ value: string }>(),
            initial: () => {
              order.push('initial')
              return { value: 'ready' }
            },
            enter: () => order.push('enter'),
          }),
        }),
    )
    const run = flow.create({})

    await run.start()

    expect(order).toEqual(['task', 'initial', 'enter'])
    expect(run.getState().steps.form?.input).toEqual({ value: 'ready' })
  })

  it('skips initialization for an existing draft and preserves the draft across back', async () => {
    let calls = 0
    const flow = defineWizard(
      { name: 'initial-back', context: boundary.trusted<{}>() },
      ({ step, view, steps }) =>
        steps({
          first: view({
            input: boundary.trusted<{ name: string }>(),
            initial: () => ({ name: `generated-${++calls}` }),
            next: 'second',
          }),
          second: view({
            next: 'done',
          }),
          done: step({ next: null }),
        }),
    )
    const run = flow.create({})

    await run.setInput('first', { name: 'manual' })
    await run.start()
    expect(calls).toBe(0)
    await run.next()
    await run.back()

    expect(calls).toBe(0)
    expect(run.getState().steps.first?.input).toEqual({ name: 'manual' })
  })

  it('retains an initialized draft across edits and back navigation', async () => {
    let calls = 0
    const flow = defineWizard(
      { name: 'initialized-back', context: boundary.trusted<{}>() },
      ({ step, view, steps }) =>
        steps({
          first: view({
            input: boundary.trusted<{ name: string }>(),
            initial: () => ({ name: `generated-${++calls}` }),
            next: 'second',
          }),
          second: view({
            next: 'done',
          }),
          done: step({ next: null }),
        }),
    )
    const run = flow.create({})

    await run.start()
    expect(run.getState().steps.first?.input).toEqual({ name: 'generated-1' })
    await run.setInput('first', { name: 'edited' })
    await run.next()
    await run.back()

    expect(calls).toBe(1)
    expect(run.getState().steps.first?.input).toEqual({ name: 'edited' })
  })

  it('reruns on reset for active and inactive views without rerunning on entry', async () => {
    let firstCalls = 0
    let secondCalls = 0
    const flow = defineWizard(
      { name: 'initial-reset', context: boundary.trusted<{}>() },
      ({ step, view, steps }) =>
        steps({
          first: view({
            input: boundary.trusted<{ value: number }>(),
            initial: () => ({ value: ++firstCalls }),
            next: 'second',
          }),
          second: view({
            input: boundary.trusted<{ value: number }>(),
            initial: () => ({ value: ++secondCalls }),
            next: 'done',
          }),
          done: step({ next: null }),
        }),
    )
    const run = flow.create({})

    await run.start()
    await run.resetInput('first')
    await run.resetInput('second')
    expect(run.getState().steps.first?.input).toEqual({ value: 2 })
    expect(run.getState().steps.second?.input).toEqual({ value: 1 })

    await run.next()
    expect(secondCalls).toBe(1)
    expect(run.getState().current).toBe('second')
  })

  it('drops older reset results and lets setInput supersede an initializer', async () => {
    const pending: Array<Deferred<{ value: string }>> = []
    let calls = 0
    const flow = defineWizard(
      { name: 'initial-race', context: boundary.trusted<{}>() },
      ({ view, steps }) =>
        steps({
          form: view({
            next: null,
            input: boundary.trusted<{ value: string }>(),
            initial: () => {
              if (calls++ === 0) return { value: 'first' }
              const next = deferred<{ value: string }>()
              pending.push(next)
              return next.promise
            },
          }),
        }),
    )
    const run = flow.create({})

    await run.start()
    await run.resetInput('form')
    await run.resetInput('form')
    expect(pending).toHaveLength(2)
    pending[1]?.resolve({ value: 'newer' })
    await flush()
    pending[0]?.resolve({ value: 'older' })
    await flush()
    expect(run.getState().steps.form?.input).toEqual({ value: 'newer' })

    await run.resetInput('form')
    expect(pending).toHaveLength(3)
    expect(await run.setInput('form', { value: 'manual' })).toMatchObject({ ok: true })
    pending[2]?.resolve({ value: 'late' })
    await flush()
    expect(run.getState().steps.form?.input).toEqual({ value: 'manual' })
  })

  it('reissues a persisted in-flight initializer on resume', async () => {
    const pending: Array<Deferred<{ value: string }>> = []
    const flow = defineWizard(
      { name: 'initial-resume', context: boundary.trusted<{}>() },
      ({ view, steps }) =>
        steps({
          form: view({
            next: null,
            input: boundary.trusted<{ value: string }>(),
            initial: () => {
              const next = deferred<{ value: string }>()
              pending.push(next)
              return next.promise
            },
          }),
        }),
    )
    const run = flow.create({}, { instanceId: 'initial-resume-1' })
    await run.start()
    const snapshot = run.getSnapshot()
    run.dispose()

    const resumed = flow.resume(snapshot)
    expect(pending).toHaveLength(2)
    pending[1]?.resolve({ value: 'restored' })
    await flush()

    expect(resumed.getState().steps.form?.input).toEqual({ value: 'restored' })
    expect(resumed.getState().steps.form?.status).toBe('active')
  })
})
