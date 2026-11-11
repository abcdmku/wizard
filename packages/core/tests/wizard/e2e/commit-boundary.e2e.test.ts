/**
 * The interpreter's commit boundary seen from a run: a hook cancelled before it starts never runs,
 * a synchronous planner failure disposes the run instead of wedging its queue, and a host barrier
 * that has not committed keeps the advanced state invisible.
 */

import { describe, expect, it } from 'vitest'
import { boundary, defineWizard } from '../../../src/index'
import { flow, runStep } from '../../helpers/fixtures'
import { e2e } from './harness'

describe('commit boundary', () => {
  it('never starts a hook that a re-entrant cancel stopped before it began', async () => {
    const charges: string[] = []
    const checkout = defineWizard(
      { name: 'checkout', context: boundary.trusted<{}>() },
      ({ step, steps }) =>
        steps({
          charge: step({
            run: () => {
              charges.push('card')
            },
          }),
        }),
    )
    const run = checkout.create({})
    run.observe((event) => {
      if (event.type === 'step.runStarted') void run.cancel('changed my mind')
    })

    await run.start()

    expect(charges).toEqual([])
    expect(run.getState().status).toBe('cancelled')
  })

  it('disposes the run when the planner throws, so later commands settle', async () => {
    const failure = new Error('id source exhausted')
    const errors: unknown[] = []
    let n = 0
    const t = e2e(flow({ start: 'charge', steps: { charge: runStep() } }), {
      ids: {
        id: (prefix) => {
          if (prefix === 'fx') throw failure
          n += 1
          return `${prefix}-${n}`
        },
      },
      onListenerError: (error) => errors.push(error),
    })

    await expect(t.run.start()).resolves.toMatchObject({ ok: false, code: 'DISPOSED' })
    await expect(t.run.cancel()).resolves.toMatchObject({ ok: false, code: 'DISPOSED' })
    expect(t.run.isDisposed()).toBe(true)
    expect(errors).toEqual([failure])
  })

  it('hands the host barrier the staged snapshot of the batch it gates', async () => {
    const barriers: Array<{ readonly staged: string; readonly committed: string }> = []
    const checkout = defineWizard(
      { name: 'checkout', context: boundary.trusted<{}>() },
      ({ step, steps }) => steps({ charge: step({ run: () => 'paid' }) }),
    )
    const run = checkout.create(
      {},
      {
        beforeEffects: ({ snapshot }) => {
          barriers.push({ staged: snapshot.state.status, committed: run.getState().status })
        },
      },
    )

    await run.start()

    expect(barriers).toEqual([
      { staged: 'running', committed: 'idle' },
      { staged: 'waiting', committed: 'running' },
      { staged: 'done', committed: 'waiting' },
    ])
  })

  it('stamps hook progress with the committed seq while a barrier is pending', async () => {
    let paid = (): void => {}
    const t = e2e(
      flow({
        start: 'charge',
        steps: {
          charge: runStep({
            run: async ({ update, progress }) => {
              await new Promise<void>((resolve) => {
                paid = resolve
              })
              update({ paid: true })
              progress(1)
            },
          }),
        },
      }),
      {
        beforeEffects: ({ events }) =>
          events.some((event) => event.type === 'context.changed')
            ? new Promise(() => {})
            : undefined,
      },
    )
    await t.run.start()

    paid()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(t.of('step.progress').map((event) => event.seq)).toEqual([t.run.getState().seq])
  })

  it.each(['resolves', 'rejects'] as const)(
    'shows only committed state while the host barrier is pending and after it %s',
    async (outcome) => {
      const failure = new Error('CAS failed')
      let settle = (): void => {}
      const gate = new Promise<void>((resolve, reject) => {
        settle = outcome === 'resolves' ? resolve : () => reject(failure)
      })
      const errors: unknown[] = []
      const t = e2e(flow({ start: 'charge', steps: { charge: runStep({ run: () => 'paid' }) } }), {
        beforeEffects: ({ snapshot }) => (snapshot.seq <= 4 ? gate : undefined),
        onListenerError: (error) => errors.push(error),
      })

      const started = t.run.start()
      expect(t.run.getState()).toMatchObject({ seq: 0, status: 'idle' })
      expect(t.run.getSnapshot().state).toMatchObject({ seq: 0, status: 'idle' })
      settle()
      await started

      const committed = outcome === 'resolves' ? 'done' : 'idle'
      expect(t.run.getState().status).toBe(committed)
      expect(t.run.getSnapshot().state.status).toBe(committed)
      expect(errors).toEqual(outcome === 'resolves' ? [] : [failure])
    },
  )
})
