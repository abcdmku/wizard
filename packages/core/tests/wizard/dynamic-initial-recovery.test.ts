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

describe('dynamic view initial recovery', () => {
  it('accepts resetInput before an async initializer settles', async () => {
    const reset = deferred<{ value: string }>()
    let calls = 0
    const flow = defineWizard(
      { name: 'initial-reset-timing', context: boundary.trusted<{}>() },
      ({ view, steps }) =>
        steps({
          form: view({
            next: null,
            input: boundary.trusted<{ value: string }>(),
            initial: () => (++calls === 1 ? { value: 'first' } : reset.promise),
          }),
        }),
    )
    const run = flow.create({})
    await run.start()

    const result = await run.resetInput('form')
    expect(result).toMatchObject({ ok: true })
    expect(run.getState().steps.form?.input).toBeUndefined()

    reset.resolve({ value: 'after-reset' })
    await flush()
    expect(run.getState().steps.form?.input).toEqual({ value: 'after-reset' })
  })

  it('records a reset initializer rejection as a persisted hook failure', async () => {
    let calls = 0
    const flow = defineWizard(
      { name: 'initial-reset-failure', context: boundary.trusted<{}>() },
      ({ view, steps }) =>
        steps({
          form: view({
            next: null,
            input: boundary.trusted<{ value: string }>(),
            initial: () => {
              calls++
              if (calls === 1) return { value: 'first' }
              throw new Error('reset defaults failed')
            },
          }),
        }),
    )
    const run = flow.create({})
    await run.start()
    await run.resetInput('form')

    expect(run.getState().steps.form).toMatchObject({
      status: 'failed',
      error: { kind: 'hook', message: 'reset defaults failed' },
    })
    const resumed = flow.resume(run.getSnapshot())
    expect(resumed.getState().steps.form).toMatchObject({
      status: 'failed',
      error: { kind: 'hook', message: 'reset defaults failed' },
    })
  })

  it('keeps one fan-out initializer draft when a sibling initializer fails', async () => {
    const left = deferred<{ value: string }>()
    const right = deferred<{ value: string }>()
    const flow = defineWizard(
      { name: 'initial-fanout', context: boundary.trusted<{}>() },
      ({ view, steps }) =>
        steps({
          first: view({
            next: ['left', 'right'],
          }),
          left: view({
            next: null,
            input: boundary.trusted<{ value: string }>(),
            initial: () => left.promise,
          }),
          right: view({
            next: null,
            input: boundary.trusted<{ value: string }>(),
            initial: () => right.promise,
          }),
        }),
    )
    const run = flow.create({})
    await run.start()
    const moving = run.next()

    left.resolve({ value: 'persisted' })
    await flush()
    expect(run.getState().steps.left?.input).toEqual({ value: 'persisted' })

    right.reject(new Error('sibling initializer failed'))
    await flush()
    expect(await moving).toMatchObject({ ok: false, code: 'HOOK_FAILED', step: 'right' })
    expect(run.getState().status).toBe('halted')
    expect(run.getState().steps.right).toMatchObject({
      status: 'failed',
      error: { kind: 'hook', message: 'sibling initializer failed' },
    })
    expect(run.getState().steps.left?.input).toEqual({ value: 'persisted' })

    const resumed = flow.resume(run.getSnapshot())
    expect(resumed.getState().steps.left?.input).toEqual({ value: 'persisted' })
  })
})
