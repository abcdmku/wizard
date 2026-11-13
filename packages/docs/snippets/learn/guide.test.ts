import type { AnyWizardDefinition } from '@openwizard/core'
import { inspect } from '@openwizard/core/inspect'
import { createTestScheduler } from '@openwizard/core/testing'
import { expect, it } from 'vitest'
import { delivery, runDelivery } from './branch'
import { checkout, runCheckout } from './children'
import { type TripDeps, trip } from './compensate'
import { runThumbnails, thumbnails } from './each'
import { hello, result } from './factory'
import { price } from './fallback'
import { signup, submitSignup } from './form'
import { debugApproval, page } from './inspect'
import { dashboard, runDashboard } from './needs'
import { upload } from './retry'
import { signupAcrossRestart } from './save-resume'
import { report, runReport } from './steps'
import { approval, approve } from './wait'

/** The test scheduler drives timers only. This lets the promise of an async step settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

it('quickstart: runs a wizard and reads the result', () => {
  expect(result).toMatchObject({ status: 'done', output: 'Hello, Ada!' })
})

it('steps: runs steps in order and calls a service through deps', async () => {
  const downloads: string[] = []
  const outcome = await runReport({
    reports: {
      download: async (reportId) => {
        downloads.push(reportId)
        return { pages: 3 }
      },
    },
  })

  expect(outcome).toMatchObject({ status: 'done', output: 'Report r-1 is ready' })
  expect(downloads).toEqual(['r-1'])
})

it('steps: runs work for each item and keeps the input order', async () => {
  expect(await runThumbnails()).toMatchObject({
    status: 'done',
    output: ['0:a.png.thumb', '1:b.png.thumb'],
  })
})

it('needs: joins the typed outputs of two steps', async () => {
  const deps = {
    users: { find: async (userId: string) => ({ name: `User ${userId}` }) },
    orders: { list: async () => [{ id: 'order-1' }, { id: 'order-2' }] },
  }
  expect(await runDashboard(deps)).toMatchObject({ status: 'done', output: 'User 7 has 2 orders' })
})

it('forms: accepts a valid draft and refuses an invalid one', async () => {
  expect(await submitSignup('ada@example.com')).toMatchObject({
    status: 'done',
    output: 'Welcome, ada@example.com',
  })
  expect(await submitSignup('not-an-email')).toMatchObject({
    ok: false,
    reason: 'validation',
    code: 'INVALID_INPUT',
    issues: [{ message: 'Invalid email address', path: ['email'] }],
  })
})

it('branch: runs the chosen target and skips the other', async () => {
  expect(await runDelivery()).toMatchObject({ status: 'done', output: 'Arrives the next day' })

  const run = delivery.create({ speed: 'standard' })
  await run.start()
  expect(await run.awaitResult()).toMatchObject({ output: 'Arrives in 3 to 5 days' })
  expect(run.getState().steps.express).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
  run.dispose()
})

it('wait: finishes when the event arrives', async () => {
  expect(await approve()).toMatchObject({ status: 'done', output: 'Approved by Grace' })
})

it('wait: reports what a parked run waits for, and rejects a bad payload', async () => {
  expect(await approval.run({})).toMatchObject({
    status: 'waiting',
    waitingFor: [{ kind: 'event', step: 'decision', events: ['approved'] }],
  })

  const run = approval.create({})
  await run.start()
  const body: unknown = { by: 42 }
  expect(await run.send('approved', body)).toMatchObject({ ok: false, code: 'BOUNDARY_REJECTED' })
  expect(await run.send('approved', { by: 'Grace' }, { eventId: 'e-1' })).toMatchObject({
    ok: true,
  })
  run.dispose()
})

it('failures: retries with the same idempotency key, three calls in total', async () => {
  const keys: string[] = []
  const scheduler = createTestScheduler()
  const run = upload.create(
    { fileId: 'f-1' },
    {
      scheduler,
      deps: {
        storage: {
          save: async (fileId, { idempotencyKey }) => {
            keys.push(idempotencyKey)
            if (keys.length < 3) throw new Error('storage is busy')
            return { url: `/files/${fileId}` }
          },
        },
      },
    },
  )
  await run.start()
  await settle()
  expect(run.explain('save')).toMatchObject({ status: 'active', phase: 'retrying' })
  scheduler.advance(1_000)
  await settle()
  scheduler.advance(1_000)

  expect(await run.awaitResult()).toMatchObject({ status: 'done', output: { url: '/files/f-1' } })
  expect(keys).toEqual(['save:f-1', 'save:f-1', 'save:f-1'])
  run.dispose()
})

it('failures: halts when retries run out, then recovers with retry()', async () => {
  let down = true
  const scheduler = createTestScheduler()
  const run = upload.create(
    { fileId: 'f-1' },
    {
      scheduler,
      deps: {
        storage: {
          save: async (fileId) => {
            if (down) throw new Error('storage is down')
            return { url: `/files/${fileId}` }
          },
        },
      },
    },
  )
  await run.start()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await settle()
    scheduler.advance(1_000)
  }
  expect(await run.awaitOutcome()).toMatchObject({
    status: 'halted',
    failure: { step: 'save', error: { message: 'storage is down', attempt: 3 } },
  })

  down = false
  expect(await run.retry('save')).toMatchObject({ ok: true })
  expect(await run.awaitResult()).toMatchObject({ status: 'done', output: { url: '/files/f-1' } })
  run.dispose()
})

it('failures: continues at the fallback step', async () => {
  const outcome = await price.run(
    { sku: 'sku-1', listPrice: 10 },
    {
      deps: {
        live: {
          price: async () => {
            throw new Error('pricing is down')
          },
        },
      },
    },
  )

  expect(outcome).toMatchObject({ status: 'done', output: 'Price: 10' })
})

it('failures: undoes the finished step when a later one fails', async () => {
  const cancelled: string[] = []
  const deps: TripDeps = {
    flights: {
      book: async () => ({ ref: 'FL-1' }),
      cancel: async (ref) => {
        cancelled.push(ref)
      },
    },
    hotels: {
      book: async () => {
        throw new Error('hotel is full')
      },
    },
  }

  expect(await trip.run({ tripId: 't-1' }, { deps })).toMatchObject({
    status: 'failed',
    failure: { step: 'hotel', compensation: { outcome: 'completed', failures: [] } },
  })
  expect(cancelled).toEqual(['FL-1'])
})

it('save and resume: continues from a stored snapshot', async () => {
  expect(await signupAcrossRestart()).toMatchObject({
    status: 'done',
    output: 'Welcome, ada@example.com',
  })
})

it('child wizards: passes the child output to the parent', async () => {
  expect(await runCheckout()).toMatchObject({ status: 'done', output: 'Ship to Keizersgracht 1' })
})

it('inspect: explains a blocked step, lists the waits and prints a trace', async () => {
  const { why, waits, trace } = await debugApproval()

  expect(why).toEqual(['not-activated', 'deps-unmet:decision'])
  expect(waits).toMatchObject([{ kind: 'event', step: 'decision', events: ['approved'] }])
  expect(trace).toContain('event approved delivered to decision')
  expect(page).toContain('| `decision` | step | its wizard starts | Waits for `approved` |')
})

it('every guide wizard compiles without warnings', () => {
  const wizards: Record<string, AnyWizardDefinition> = {
    hello,
    report,
    thumbnails,
    dashboard,
    signup,
    delivery,
    approval,
    upload,
    price,
    trip,
    checkout,
  }
  for (const [name, wizard] of Object.entries(wizards)) {
    expect(inspect(wizard).warnings, name).toEqual([])
  }
})
