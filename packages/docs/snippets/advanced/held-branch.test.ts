import { expect, it } from 'vitest'
import { dispatch } from './held-branch'

it('holds the chosen branch until its need is done', async () => {
  const run = dispatch.create({ approved: true })
  await run.start()

  expect(run.explain('ship').reasons).toEqual(['deps-unmet:audit'])
  await run.send('audited', { auditId: 'a-1' })

  expect(run.getState().steps.ship).toMatchObject({ status: 'done', output: 'shipped under a-1' })
  expect(await run.awaitResult()).toMatchObject({ status: 'done' })
  run.dispose()
})

it('leaves the branch that was not chosen skipped when its need finishes', async () => {
  const run = dispatch.create({ approved: false })
  await run.start()
  await run.send('audited', { auditId: 'a-1' })

  expect(await run.awaitResult()).toMatchObject({ status: 'done' })
  expect(run.getState().steps.ship).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
  expect(run.getState().steps.cancel).toMatchObject({ status: 'done', output: 'cancelled' })
  run.dispose()
})
