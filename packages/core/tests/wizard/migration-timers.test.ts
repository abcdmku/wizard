import { expect, it } from 'vitest'
import { z } from 'zod'
import { defineWizard, renameSteps } from '../../src'
import { createTestScheduler } from '../../src/testing'

it('renames a persisted sleep timer without changing its deadline', async () => {
  const old = defineWizard({ name: 'renamed-sleep', context: z.object({}) }, ({ step, steps }) =>
    steps({
      nap: step({ sleep: '10ms', next: 'end' }),
      end: step({ run: () => 42 }),
    }),
  )
  const next = defineWizard(
    { name: 'renamed-sleep', version: 2, context: z.object({}) },
    ({ step, steps }) =>
      steps({
        delay: step({ sleep: '10ms', next: 'end' }),
        end: step({ run: () => 42 }),
      }),
  )
  const time = createTestScheduler({ now: 0 })
  const run = old.create({}, { scheduler: time })
  await run.start()
  const snapshot = JSON.parse(JSON.stringify(run.getSnapshot()))
  run.dispose()
  const resumed = next.resume(snapshot, {
    scheduler: time,
    migrate: (snapshot) => renameSteps(snapshot, { nap: 'delay' }),
  })
  expect(resumed.waitingFor()).toEqual([{ kind: 'sleep', path: [], step: 'delay', deadline: 10 }])
  time.advance(10)
  expect(await resumed.awaitResult()).toMatchObject({ status: 'done', output: 42 })
  resumed.dispose()
})

it('renames encoded per-item retry timers and retries only the interrupted item', async () => {
  const old = defineWizard({ name: 'renamed-each', context: z.object({}) }, ({ step, steps }) =>
    steps({
      'old/map': step({
        each: () => [1],
        retry: { retries: 1, backoff: 10 },
        run: () => {
          throw new Error('offline')
        },
      }),
    }),
  )
  const next = defineWizard(
    { name: 'renamed-each', version: 2, context: z.object({}) },
    ({ step, steps }) =>
      steps({
        'new/map': step({
          each: () => [1],
          retry: { retries: 1, backoff: 10 },
          run: ({ attempt }) => attempt,
        }),
      }),
  )
  const time = createTestScheduler({ now: 0 })
  const run = old.create({}, { scheduler: time })
  await run.start()
  const snapshot = JSON.parse(JSON.stringify(run.getSnapshot()))
  run.dispose()
  const resumed = next.resume(snapshot, {
    scheduler: time,
    migrate: (snapshot) => renameSteps(snapshot, { 'old/map': 'new/map' }),
  })
  expect(Object.keys(resumed.getState().timers)).toEqual(['each-retry:new%2Fmap:0'])
  time.advance(10)
  expect(await resumed.awaitResult()).toMatchObject({ status: 'done', output: [2] })
  resumed.dispose()
})
