import { createTestScheduler } from '@openwizard/core/testing'
import { expect, it, vi } from 'vitest'
import { upload } from './retry' // the wizard from Handle failures
import { approval } from './wait' // the wizard from Wait for events and time

it('saves the file through the storage service', async () => {
  const save = vi.fn(async () => ({ url: '/files/f-1' }))

  const outcome = await upload.run({ fileId: 'f-1' }, { deps: { storage: { save } } })

  expect(outcome).toMatchObject({ status: 'done', output: { url: '/files/f-1' } })
  expect(save).toHaveBeenCalledWith('f-1', { idempotencyKey: 'save:f-1' })
})

it('closes an approval nobody answered', async () => {
  const scheduler = createTestScheduler()
  const run = approval.create({}, { scheduler })
  await run.start()

  scheduler.advance(48 * 60 * 60 * 1000)

  expect(await run.awaitResult()).toMatchObject({
    status: 'done',
    output: 'Expired after 48 hours',
  })
  run.dispose()
})
