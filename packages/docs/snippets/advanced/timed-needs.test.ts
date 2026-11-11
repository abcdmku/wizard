import { expect, it } from 'vitest'
import { approval, expireApproval } from './timed-needs'

it('skips the timed-out wait and gives the optional need undefined', async () => {
  const { result, decision } = await expireApproval()

  expect(result).toMatchObject({ status: 'done', output: 'expired' })
  expect(decision).toMatchObject({ status: 'skipped', skipReason: 'timeout' })
})

it('passes the decision to the same step when the event arrives in time', async () => {
  const run = approval.create({})
  await run.start()
  await run.send('decided', { accepted: true })

  expect(await run.awaitResult()).toMatchObject({ status: 'done', output: 'approved' })
  run.dispose()
})
