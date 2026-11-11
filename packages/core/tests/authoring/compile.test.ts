import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { compile } from '../../src/authoring/compile'
import { defineWizard } from '../../src/wizard/define-wizard'
import { hookArgs, issuesOf, rawFlow, rawStep } from './helpers'

describe('compiled execution contracts', () => {
  it('normalizes durations, event boundaries, policies and declared entry points', () => {
    const wizard = defineWizard(
      {
        name: 'policies',
        version: 2,
        context: z.object({ a: z.string() }),
        events: { ping: z.object({ n: z.number() }) },
        deps: boundary.trusted<{ log: (message: string) => void }>(),
        onFailure: 'compensate',
        retry: { retries: 1, backoff: 1000 },
        autoRun: 'manual',
        concurrency: 3,
        unmatchedEvents: { buffer: false, ttl: '1m' },
      },
      ({ step, steps }) =>
        steps(
          {
            work: step({ run: () => 1, timeout: '5s', next: 'wait' }),
            wait: step({
              waitFor: { ping: ({ payload }) => ({ done: payload.n }) },
              timeout: { after: '15m', next: 'late' },
            }),
            late: step({ run: () => 'late' }),
          },
          { start: 'work' },
        ),
    )
    const def = compile(wizard)
    expect(def.start).toEqual(['work'])
    expect(def.context.parse({ a: 'ok' })).toEqual({ ok: true, value: { a: 'ok' } })
    expect(def.events.ping?.parse({ n: 2 })).toEqual({ ok: true, value: { n: 2 } })
    expect(def.policies).toEqual({
      onFailure: 'compensate',
      retry: { retries: 1, backoff: 1000 },
      autoRun: 'manual',
      concurrency: 3,
      unmatchedEvents: { buffer: false, ttlMs: 60_000 },
    })
    expect(def.steps.work?.timeoutMs).toBe(5000)
    expect(def.steps.wait?.waitTimeout).toEqual({ afterMs: 900_000, next: 'late' })
  })

  it('makes needs pull activation explicit and keeps alternate edges out of sink roles', () => {
    const wizard = defineWizard(
      { name: 'joins', context: z.object({}), events: { ready: z.boolean() } },
      ({ step, steps }) => {
        const a = step({ run: () => 1, fallback: 'recover' })
        const b = step({ run: () => 'b' })
        const wait = step({
          waitFor: { ready: () => ({ done: true }) },
          timeout: { after: '1m', next: 'recover' },
        })
        return steps(
          {
            a,
            b,
            wait,
            join: step({
              needs: { a, chosen: { any: [b, wait] }, maybe: { optional: b } },
              run: ({ needs }) => [needs.a, needs.chosen, needs.maybe],
            }),
            recover: step({ run: () => 'recovered' }),
          },
          { start: ['a', 'b', 'wait'] },
        )
      },
    )
    const def = compile(wizard)
    expect(def.steps.join?.needs).toEqual({
      a: { kind: 'all', steps: ['a'] },
      chosen: { kind: 'any', steps: ['b', 'wait'] },
      maybe: { kind: 'optional', steps: ['b'] },
    })
    expect(def.feeds).toEqual({ a: ['join'], b: ['join'], wait: ['join'] })
    expect(def.sinks).toEqual(['join', 'recover'])

    const alternate = compile(
      rawFlow(
        {
          work: rawStep({ run: () => 1, fallback: 'recover' }),
          wait: rawStep({
            waitFor: { ready: () => ({ done: true }) },
            timeout: { after: '1m', next: 'recover' },
          }),
          recover: rawStep({ run: () => 2 }),
        },
        { events: { ready: z.boolean() } },
      ),
    )
    expect(alternate.sinks).toEqual(['work', 'wait', 'recover'])
  })

  it('parses transformed view values before invoking validate', async () => {
    const seen: number[] = []
    const wizard = defineWizard({ name: 'form', context: z.object({}) }, ({ view, steps }) =>
      steps({
        form: view({
          input: z.object({ qty: z.string().transform(Number) }),
          initial: { qty: '1' },
          validate: ({ output }) => {
            seen.push(output.qty)
            return output.qty > 0 ? undefined : [{ message: 'qty must be positive' }]
          },
        }),
      }),
    )
    const run = wizard.create({})
    try {
      await run.start()
      await run.setInput('form', { qty: '0' })
      expect(await run.validate('form')).toEqual([{ message: 'qty must be positive' }])
      await run.setInput('form', { qty: '2' })
      expect(await run.validate('form')).toEqual([])
      await run.next()
      expect(await run.awaitResult()).toMatchObject({ status: 'done', output: { qty: 2 } })
      expect(seen).toEqual([0, 2, 2])
    } finally {
      run.dispose()
    }
  })

  it('keeps retry tuning and predicate intact without filling machine defaults', () => {
    const when = (error: unknown) => error instanceof Error
    const def = compile(
      rawFlow({
        work: rawStep({
          run: () => 1,
          retry: {
            retries: 2,
            backoff: 'exponential',
            baseMs: 50,
            factor: 3,
            maxBackoffMs: 900,
            jitter: 0.5,
            when,
          },
        }),
      }),
    )
    expect(def.steps.work?.retry).toEqual({
      retries: 2,
      backoff: 'exponential',
      baseMs: 50,
      factor: 3,
      maxBackoffMs: 900,
      jitter: 0.5,
      when,
    })
    expect(
      compile(rawFlow({ work: rawStep({ run: () => 1, retry: { retries: 2 } }) })).steps.work
        ?.retry,
    ).toEqual({ retries: 2 })
  })

  it('compiles static and context-dependent sleep durations to milliseconds', async () => {
    const wizard = defineWizard(
      { name: 'delays', context: z.object({ seconds: z.number() }) },
      ({ step, steps }) =>
        steps({
          fixed: step({ sleep: '1.5s', next: 'variable' }),
          variable: step({ sleep: ({ context }) => context.seconds * 1000 }),
        }),
    )
    const def = compile(wizard)
    expect(def.steps.fixed?.sleep).toBe(1500)
    const variable = def.steps.variable?.sleep
    expect(variable).toBeTypeOf('function')
    if (typeof variable !== 'function') throw new Error('sleep hook was not compiled')
    expect(await variable(hookArgs({ context: { seconds: 2 } }))).toBe(2000)
  })

  it('supports bounded and unbounded item execution', () => {
    const wizard = defineWizard(
      { name: 'item-concurrency', context: z.object({ ids: z.array(z.string()) }) },
      ({ step, steps }) =>
        steps({
          bounded: step({
            each: ({ context }) => context.ids,
            run: ({ item }) => item.length,
            concurrency: 2,
          }),
          unbounded: step({
            each: ({ context }) => context.ids,
            run: ({ item }) => item.length,
            concurrency: Number.POSITIVE_INFINITY,
          }),
        }),
    )
    expect(compile(wizard).steps.bounded?.each?.concurrency).toBe(2)
    expect(compile(wizard).steps.unbounded?.each?.concurrency).toBe(Number.POSITIVE_INFINITY)
  })

  it.each([
    [{ retries: -1 }, 'retry.retries must be a non-negative integer'],
    [
      { retries: 1, backoff: 'linear' },
      "retry.backoff must be a number of ms >= 0 or 'exponential'",
    ],
    [{ retries: 1, backoff: -5 }, "retry.backoff must be a number of ms >= 0 or 'exponential'"],
    [{ retries: 1, factor: 2 }, "retry.factor only applies to backoff: 'exponential'"],
    [{ retries: 1, backoff: 'exponential', factor: 0.5 }, 'retry.factor must be a number >= 1'],
    [{ retries: 1, backoff: 'exponential', baseMs: -1 }, 'retry.baseMs must be a number >= 0'],
    [{ retries: 1, jitter: 1.5 }, 'retry.jitter must be a number from 0 to 1'],
    [{ retries: 1, when: 'fatal' }, 'retry.when must be a function (error) => boolean'],
  ])('rejects malformed retry policy %j', (retry, message) => {
    expect(issuesOf(() => compile(rawFlow({ work: rawStep({ run: () => 1, retry }) })))).toEqual([
      `step 'work': ${message}`,
    ])
  })

  it('passes mapped errors to mapError and validates custom idempotency keys', async () => {
    const boom = new Error('boom')
    const seen: unknown[] = []
    const def = compile(
      rawFlow({
        work: rawStep({
          run: () => 1,
          mapError: (error: unknown, args: { attempt: number }) => {
            seen.push(error, args.attempt)
            return { code: 'DOWN' }
          },
          idempotencyKey: () => '',
        }),
      }),
    )
    expect(await def.steps.work?.hooks.mapError?.(hookArgs({ error: boom, attempt: 3 }))).toEqual({
      code: 'DOWN',
    })
    expect(seen).toEqual([boom, 3])
    await expect(async () => def.steps.work?.hooks.idempotencyKey?.(hookArgs())).rejects.toThrow(
      'an idempotency key function must return a non-empty string',
    )
  })
})
