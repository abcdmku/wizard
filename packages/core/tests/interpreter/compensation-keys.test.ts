import { expect, it } from 'vitest'
import { flow, runStep } from '../helpers/fixtures'
import { e2e, e2eResume, roundTrip } from '../wizard/e2e/harness'

it('uses a distinct stable compensation key for each completion of a looping step', async () => {
  let iterations = 0
  let failCompensation = true
  const calls: Array<{ key: string; output: unknown }> = []
  const def = flow({
    start: 'work',
    policies: { onFailure: 'compensate' },
    steps: {
      work: runStep({
        run: () => ++iterations,
        dynamicNext: ({ output }) => (output === 1 ? 'work' : 'boom'),
        targets: ['work', 'boom'],
        compensate: ({ idempotencyKey, output }) => {
          calls.push({ key: idempotencyKey, output })
          if (output === 2 && failCompensation) throw new Error('try compensation again')
        },
      }),
      boom: runStep({
        run: () => {
          throw new Error('stop')
        },
      }),
    },
  })
  const t = e2e(def, { instanceId: 'saga-keys' })
  await t.run.start()
  expect(t.run.getState().status).toBe('failed')
  const snapshot = roundTrip(t.run.getSnapshot())
  t.run.dispose()
  const resumed = e2eResume(def, snapshot)
  failCompensation = false
  await resumed.run.compensate({ from: 'work' })
  expect(calls).toEqual([
    { key: 'saga-keys:work:2:compensate', output: 2 },
    { key: 'saga-keys:work:1:compensate', output: 1 },
    { key: 'saga-keys:work:2:compensate', output: 2 },
  ])
  resumed.run.dispose()
})
