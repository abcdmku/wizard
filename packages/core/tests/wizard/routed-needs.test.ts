/**
 * A step named in the `targets` of a function `next` starts only when that function returns it.
 * Its needs hold it afterwards and never start it, whichever of the two finishes first.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineWizard } from '../../src'

const events = {
  audited: z.object({}),
  decided: z.object({ to: z.enum(['ship', 'cancel']) }),
}

/** `route` chooses `ship` or `cancel`. `ship` also waits for `audit`, which runs in parallel. */
function dispatch(router: 'routing step' | 'runnable step', needsRouter: boolean, ran: string[]) {
  return defineWizard(
    { name: 'dispatch', context: z.object({}), events, output: () => ran.join(',') },
    ({ step, steps }) => {
      const audit = step({ waitFor: { audited: () => ({ done: 'clean' }) } })
      const decision = step({ waitFor: { decided: ({ payload }) => ({ done: payload.to }) } })
      const route =
        router === 'routing step'
          ? step({
              needs: { decision },
              targets: ['ship', 'cancel'],
              next: ({ needs }) => needs.decision,
            })
          : step({
              needs: { decision },
              run: ({ needs }) => needs.decision,
              targets: ['ship', 'cancel'],
              next: ({ output }) => output,
            })
      const work = (name: string) => () => {
        ran.push(name)
        return name
      }
      const ship = needsRouter
        ? step({ needs: { route, audit }, run: work('ship') })
        : step({ needs: { audit }, run: work('ship') })
      const cancel = step({ run: work('cancel') })
      return steps({ audit, decision, route, ship, cancel }, { start: ['audit', 'decision'] })
    },
  )
}

const cases = (['routing step', 'runnable step'] as const).flatMap((router) =>
  [true, false].flatMap((needsRouter) =>
    (['need first', 'choice first'] as const).map((order) => ({ router, needsRouter, order })),
  ),
)

describe('needs on a routed step', () => {
  it.each(cases)(
    'a $router never starts the target it did not take (needs its router: $needsRouter, $order)',
    async ({ router, needsRouter, order }) => {
      const ran: string[] = []
      const run = dispatch(router, needsRouter, ran).create({})
      await run.start()
      if (order === 'need first') {
        await run.send('audited', {})
        expect(run.explain('ship')).toMatchObject({ status: 'idle', phase: undefined })
        await run.send('decided', { to: 'cancel' })
      } else {
        await run.send('decided', { to: 'cancel' })
        expect(run.getState().steps.ship).toMatchObject({
          status: 'skipped',
          skipReason: 'not-taken',
        })
        await run.send('audited', {})
      }
      expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 'cancel' })
      expect(ran).toEqual(['cancel'])
      expect(run.getState().steps.ship).toMatchObject({
        status: 'skipped',
        skipReason: 'not-taken',
      })
      expect(run.explain('ship').reasons).toContain('skipped:not-taken')
      run.dispose()
    },
  )

  it.each(cases)(
    'a $router starts the target it took once, after its needs (needs its router: $needsRouter, $order)',
    async ({ router, needsRouter, order }) => {
      const ran: string[] = []
      const run = dispatch(router, needsRouter, ran).create({})
      await run.start()
      if (order === 'need first') {
        await run.send('audited', {})
        expect(ran).toEqual([])
        await run.send('decided', { to: 'ship' })
      } else {
        await run.send('decided', { to: 'ship' })
        expect(ran).toEqual([])
        expect(run.explain('ship')).toMatchObject({
          status: 'idle',
          phase: 'blocked',
          reasons: ['deps-unmet:audit'],
        })
        await run.send('audited', {})
      }
      expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 'ship' })
      expect(ran).toEqual(['ship'])
      expect(run.getState().steps.cancel).toMatchObject({
        status: 'skipped',
        skipReason: 'not-taken',
      })
      run.dispose()
    },
  )

  it('keeps a not-taken target skipped after a resume, when its need completes later', async () => {
    const ran: string[] = []
    const wizard = dispatch('routing step', true, ran)
    const first = wizard.create({})
    await first.start()
    await first.send('decided', { to: 'cancel' })
    const snapshot: unknown = JSON.parse(JSON.stringify(first.getSnapshot()))
    first.dispose()

    const second = wizard.resume(snapshot)
    await second.send('audited', {})
    expect(await second.awaitResult()).toMatchObject({ status: 'done' })
    expect(ran).toEqual(['cancel'])
    expect(second.getState().steps.ship).toMatchObject({
      status: 'skipped',
      skipReason: 'not-taken',
    })
    second.dispose()
  })
})
