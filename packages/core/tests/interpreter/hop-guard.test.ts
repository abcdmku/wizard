/**
 * The auto-advance loop guard counts synchronous hops only — an asynchronously settled hook
 * or child flow restarts it — and its error names the steps of the loop.
 */
import { describe, expect, it } from 'vitest'
import type { HookArgs } from '../../src/authoring/compiled'
import { flow, flowStep, runStep } from '../helpers/fixtures'
import { e2e } from '../wizard/e2e/harness'

const counter = ({ context }: HookArgs) => (context as { i: number }).i
const bump = ({ context, update }: HookArgs) => {
  update({ i: (context as { i: number }).i + 1 })
}

describe('auto-advance hop guard', () => {
  it('lets a 1500-iteration loop over an async run finish', async () => {
    const def = flow({
      start: 'one',
      steps: {
        one: runStep({
          run: async (args) => bump(args),
          dynamicNext: (args) => (counter(args) < 1500 ? 'one' : null),
        }),
      },
    })
    const t = e2e(def, { context: { i: 0 } })
    await t.run.start()
    expect((await t.run.awaitResult()).status).toBe('done')
    expect(t.run.getState().context).toEqual({ i: 1500 })
  })

  it('lets a 1500-iteration loop over an async child flow finish', async () => {
    const child = flow({
      name: 'item',
      start: 'work',
      steps: { work: runStep({ run: async () => 1 }) },
    })
    const def = flow({
      start: 'each',
      steps: {
        each: flowStep(child, { dynamicNext: (args) => (counter(args) < 1500 ? 'bump' : null) }),
        bump: runStep({ run: bump, next: 'each' }),
      },
    })
    const t = e2e(def, { context: { i: 0 } })
    await t.run.start()
    expect((await t.run.awaitResult()).status).toBe('done')
    expect(t.run.getState().context).toEqual({ i: 1500 })
  })

  it('fails a synchronous loop over a child flow with AUTO_ADVANCE_LOOP', async () => {
    const child = flow({ name: 'item', start: 'work', steps: { work: runStep({ run: () => 1 }) } })
    const def = flow({
      start: 'each',
      steps: {
        each: flowStep(child, { next: 'bump' }),
        bump: runStep({ run: bump, next: 'each' }),
      },
    })
    const t = e2e(def, { context: { i: 0 } })
    await t.run.start()
    expect(t.run.getState().status).toBe('failed')
    expect(t.of('flow.failed')[0]).toMatchObject({ code: 'AUTO_ADVANCE_LOOP' })
  })

  it('fails a synchronous loop with AUTO_ADVANCE_LOOP naming its last steps', async () => {
    const def = flow({
      start: 'one',
      steps: {
        one: runStep({ run: bump, next: 'two' }),
        two: runStep({ run: () => 1, next: 'one' }),
      },
    })
    const t = e2e(def, { context: { i: 0 } })
    await t.run.start()
    expect(t.run.getState().status).toBe('failed')
    expect(t.of('flow.failed')[0]).toMatchObject({
      code: 'AUTO_ADVANCE_LOOP',
      step: 'one',
      error: {
        message:
          "auto-advance made 1002 synchronous hops without an async boundary (a sync 'next' loop?); last steps: 'one' → 'two' → 'one' → 'two' → 'one'",
      },
    })
  })
})
