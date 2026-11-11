/** Projected waits are flat, explicitly exposed and relative to the projected run. */
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { defineProjection } from '../../src/projection/define-projection'
import { defineWizard } from '../../src/wizard/define-wizard'

const child = defineWizard(
  {
    name: 'waiting-child',
    context: boundary.trusted<{ id: string }>(),
    events: { approved: boundary.trusted<{ accepted: boolean }>() },
  },
  ({ step, steps }) =>
    steps({
      approval: step({
        waitFor: { approved: ({ payload }) => ({ done: payload.accepted }) },
        timeout: { after: '10s', next: 'end' },
        next: 'end',
      }),
      end: step({ next: null }),
    }),
)

describe('projection waitingFor', () => {
  it('exposes view, sleep and child event waits as one flat list and omits it by default', async () => {
    const wizard = defineWizard(
      { name: 'waiting-root', context: boundary.trusted<Record<string, never>>() },
      ({ step, view, flow, steps }) =>
        steps(
          {
            form: view({ input: boundary.trusted<{ note: string }>() }),
            sub: flow(child, { context: () => ({ id: 'one' }) }),
            nap: step({ sleep: '1m' }),
          },
          { start: ['form', 'sub', 'nap'] },
        ),
    )
    const run = wizard.create({}, { scheduler: createTestScheduler({ now: 1_000 }) })
    await run.start()
    await run.whenIdle()
    const projection = defineProjection(wizard, { expose: { waitingFor: true } })
    const expected = [
      { kind: 'view', path: [], step: 'form' },
      { kind: 'sleep', path: [], step: 'nap', deadline: 61_000 },
      { kind: 'event', path: ['sub'], step: 'approval', events: ['approved'], deadline: 11_000 },
    ]

    expect(run.project(projection).waitingFor).toEqual(expected)
    expect(run.waitingFor()).toEqual(expected)
    expect(run.project(defineProjection(wizard, { expose: {} }))).not.toHaveProperty('waitingFor')
    run.dispose()
  })

  it('rebases nested projected child waits to that child', async () => {
    const wizard = defineWizard(
      { name: 'waiting-nested', context: boundary.trusted<Record<string, never>>() },
      ({ flow, steps }) => steps({ sub: flow(child, { context: () => ({ id: 'one' }) }) }),
    )
    const run = wizard.create({}, { scheduler: createTestScheduler({ now: 1_000 }) })
    await run.start()
    const projection = defineProjection(wizard, {
      expose: { steps: { sub: { child: { waitingFor: true } } } },
    })

    expect(run.project(projection).steps.sub.child?.waitingFor).toEqual([
      { kind: 'event', path: [], step: 'approval', events: ['approved'], deadline: 11_000 },
    ])
    const childProjection = defineProjection(child, { expose: { waitingFor: true } })
    expect(run.child('sub').project(childProjection).waitingFor).toEqual([
      { kind: 'event', path: [], step: 'approval', events: ['approved'], deadline: 11_000 },
    ])
    run.dispose()
  })

  it('includes every live mapped child using its stable item address', async () => {
    const wizard = defineWizard(
      { name: 'waiting-map', context: boundary.trusted<Record<string, never>>() },
      ({ flow, steps }) =>
        steps({
          batch: flow(child, {
            each: () => ['a', 'b'],
            key: (item) => item,
            concurrency: 2,
            context: ({ item }) => ({ id: item }),
          }),
        }),
    )
    const run = wizard.create({}, { scheduler: createTestScheduler({ now: 1_000 }) })
    await run.start()
    await run.whenIdle()
    const projection = defineProjection(wizard, { expose: { waitingFor: true } })

    expect(run.project(projection).waitingFor).toEqual([
      {
        kind: 'event',
        path: ['batch', '0'],
        step: 'approval',
        events: ['approved'],
        deadline: 11_000,
      },
      {
        kind: 'event',
        path: ['batch', '1'],
        step: 'approval',
        events: ['approved'],
        deadline: 11_000,
      },
    ])
    run.dispose()
  })
})
