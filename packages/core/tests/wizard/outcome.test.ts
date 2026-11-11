import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineWizard } from '../../src'
import { createTestScheduler } from '../../src/testing'

describe('run outcomes', () => {
  it('resolves a halted asynchronous failure and preserves its resumable snapshot', async () => {
    const wizard = defineWizard({ name: 'async-fail', context: z.object({}) }, ({ step, steps }) =>
      steps({
        boom: step({
          run: async () => {
            throw new Error('down')
          },
        }),
      }),
    )
    const outcome = await wizard.run({})
    expect(outcome).toMatchObject({
      status: 'halted',
      failure: { kind: 'step', step: 'boom', error: { kind: 'run', message: 'down' } },
    })
    expect(outcome.status === 'halted' && outcome.snapshot.state.status).toBe('halted')
  })

  it('returns a synchronous business failure as a halt', () => {
    const wizard = defineWizard({ name: 'sync-fail', context: z.object({}) }, ({ step, steps }) =>
      steps({
        boom: step({
          run: () => {
            throw new Error('business rule')
          },
        }),
      }),
    )
    expect(wizard.runSync({})).toMatchObject({
      status: 'halted',
      failure: { step: 'boom', error: { kind: 'run', message: 'business rule' } },
    })
  })

  it('lists own and child outside waits flat in every outcome/query', async () => {
    const child = defineWizard({ name: 'child', context: z.object({}) }, ({ view, steps }) =>
      steps({ ask: view({ input: z.object({}) }) }),
    )
    const parent = defineWizard(
      { name: 'parent', context: z.object({}), events: { approved: z.object({}) } },
      ({ step, flow, steps }) =>
        steps(
          {
            approval: step({
              waitFor: { approved: () => ({ done: true }) },
              timeout: { after: '1h', next: 'end' },
              next: 'end',
            }),
            sub: flow(child, { context: () => ({}), next: 'end' }),
            end: step({ run: () => undefined }),
          },
          { start: ['approval', 'sub'] },
        ),
    )
    const waits = [
      { kind: 'event', path: [], step: 'approval', events: ['approved'], deadline: 3_600_000 },
      { kind: 'view', path: ['sub'], step: 'ask' },
    ]
    const scheduler = createTestScheduler({ now: 0 })
    expect(await parent.run({}, { scheduler })).toMatchObject({
      status: 'waiting',
      waitingFor: waits,
    })
    const run = parent.create({}, { scheduler })
    await run.start()
    expect(run.waitingFor()).toEqual(waits)
    expect(run.explain('end').waitingFor).toEqual(waits)
    run.dispose()
  })

  it('awaitOutcome waits through sleep, keeps the run alive and then follows it to done', async () => {
    const wizard = defineWizard({ name: 'nap', context: z.object({}) }, ({ step, view, steps }) =>
      steps({
        nap: step({ sleep: '5s', next: 'form' }),
        form: view({ input: z.object({ name: z.string() }), next: 'end' }),
        end: step({ run: ({ context }) => context }),
      }),
    )
    const scheduler = createTestScheduler({ now: 0 })
    const run = wizard.create({}, { scheduler })
    await run.start()
    expect(run.waitingFor()).toEqual([{ kind: 'sleep', path: [], step: 'nap', deadline: 5_000 }])
    const parked = run.awaitOutcome()
    scheduler.advance(5_000)
    expect(await parked).toMatchObject({
      status: 'waiting',
      waitingFor: [{ kind: 'view', path: [], step: 'form' }],
    })
    await run.setInput('form', { name: 'Ada' })
    await run.next()
    expect(await run.awaitOutcome()).toMatchObject({ status: 'done', output: {} })
    run.dispose()
    await expect(run.awaitOutcome()).rejects.toMatchObject({ code: 'RUN_DISPOSED' })
  })

  it('recovers a halted run with the patched context', async () => {
    const wizard = defineWizard(
      { name: 'charge', context: z.object({ card: z.string() }) },
      ({ step, steps }) =>
        steps({
          charge: step({
            run: ({ context }) => {
              if (context.card === 'expired') throw new Error('card expired')
              return context.card
            },
          }),
        }),
    )
    const run = wizard.create({ card: 'expired' })
    await run.start()
    expect(await run.awaitOutcome()).toMatchObject({
      status: 'halted',
      failure: { step: 'charge' },
    })
    expect(await run.retry('charge', { patch: { card: 'visa' } })).toMatchObject({ ok: true })
    expect(await run.awaitOutcome()).toMatchObject({ status: 'done', output: 'visa' })
    run.dispose()
  })

  it('cancel before start settles the terminal waiter', async () => {
    const wizard = defineWizard(
      { name: 'early-cancel', context: z.object({}) },
      ({ view, steps }) => steps({ form: view({ input: z.object({}) }) }),
    )
    const run = wizard.create({})
    const result = run.awaitResult()
    expect(await run.cancel('changed my mind')).toMatchObject({ ok: true })
    expect(await result).toMatchObject({
      status: 'cancelled',
      failure: { kind: 'cancelled', reason: 'changed my mind' },
    })
    run.dispose()
  })

  it('returns all indexed child waits with the item index in their paths', async () => {
    const child = defineWizard(
      { name: 'item', context: z.object({ id: z.number() }) },
      ({ view, steps }) => steps({ ask: view({ input: z.object({}) }) }),
    )
    const parent = defineWizard(
      { name: 'items', context: z.object({ ids: z.array(z.number()) }) },
      ({ flow, steps }) =>
        steps({
          items: flow(child, {
            each: ({ context }) => context.ids,
            context: ({ item }) => ({ id: item }),
          }),
        }),
    )
    const outcome = await parent.run({ ids: [1, 2] })
    expect(outcome).toMatchObject({
      status: 'waiting',
      waitingFor: [
        { kind: 'view', path: ['items', '0'], step: 'ask' },
        { kind: 'view', path: ['items', '1'], step: 'ask' },
      ],
    })
  })
})
