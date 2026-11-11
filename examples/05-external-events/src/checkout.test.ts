import { parseCommand, type RunEvent } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import { checkoutFlow } from './checkout'

const MINUTE = 60_000
const T0 = 1_000_000

function make() {
  const scheduler = createTestScheduler({ now: T0 })
  // `correlationId` = the order id: correlated events for another order are dropped.
  const run = checkoutFlow.create(
    { orderId: 'o-1' },
    {
      correlationId: 'o-1',
      scheduler: scheduler,
    },
  )
  const events: RunEvent<typeof checkoutFlow>[] = []
  run.observe((event) => events.push(event))
  const eventsOfType = <T extends RunEvent['type']>(type: T) =>
    events.filter(
      (event): event is Extract<RunEvent<typeof checkoutFlow>, { type: T }> => event.type === type,
    )
  return { run, scheduler, events, eventsOfType }
}

// What a webhook endpoint receives: `unknown` bodies.
const goodBody: unknown = { paymentId: 'pay_1', amount: 42, orderId: 'o-1' }
const badBody: unknown = { paymentId: 42, amount: -1 }

describe('05 external events: send() through the event boundary, inbox, TTL, timeout', () => {
  it('rejects a bad payload as a value and delivers a good one to the active wait step', async () => {
    const { run, eventsOfType } = make()
    await run.start()
    expect(await run.next()).toMatchObject({ ok: true, from: 'review', to: 'awaitPayment' })
    expect(run.getState().status).toBe('waiting')

    // The boundary rejects the payload: `event.rejected` + a result with the schema's issues.
    const rejected = await run.send('payment.captured', badBody)
    expect(rejected).toMatchObject({ ok: false, reason: 'rejected' })
    if (rejected.ok || rejected.reason !== 'rejected') throw new Error('unreachable')
    expect(rejected.issues.map((issue) => issue.path)).toEqual([['paymentId'], ['amount']])
    expect(eventsOfType('event.rejected')[0]).toMatchObject({ event: 'payment.captured' })
    expect(run.getState().steps.awaitPayment.status).toBe('active') // nothing changed
    expect(run.getState().context.paymentId).toBeUndefined()

    // A good one is delivered to the listening wait step; the handler ran; the step completed.
    const delivered = await run.send('payment.captured', goodBody, { correlationId: 'wh-77' })
    expect(delivered).toMatchObject({ ok: true, delivered: ['awaitPayment'], buffered: false })
    expect(eventsOfType('event.received')[0]).toMatchObject({
      event: 'payment.captured',
      correlationId: 'wh-77',
      payload: { paymentId: 'pay_1', amount: 42, orderId: 'o-1' },
    })
    expect(eventsOfType('event.delivered')[0]).toMatchObject({
      event: 'payment.captured',
      to: 'awaitPayment',
    })
    expect(run.getState().context.paymentId).toBe('pay_1')
    expect(run.getState().steps.awaitPayment).toMatchObject({
      status: 'done',
      output: {
        paymentId: 'pay_1',
        amount: 42,
        orderId: 'o-1',
      },
    })
    expect(run.getState().status).toBe('done')
    expect(run.getState().output).toBe('paid (pay_1)')
    expect(run.getState().timers).toEqual({}) // the 30-minute timeout was cleared

    // Terminal: a late webhook is dropped (a value), never thrown.
    expect(await run.send('payment.captured', goodBody)).toMatchObject({
      ok: false,
      reason: 'dropped',
    })
    run.dispose()
  })

  it('buffers an early event and delivers it when the wait step starts', async () => {
    const { run, scheduler, eventsOfType } = make()
    await run.start()
    expect(run.getState().current).toBe('review') // nobody listens yet

    const early = await run.send('payment.captured', goodBody)
    expect(early).toMatchObject({ ok: true, delivered: [], buffered: true })
    expect(eventsOfType('event.buffered')[0]).toMatchObject({
      event: 'payment.captured',
      expiresAt: T0 + 10 * MINUTE,
    })
    expect(run.getState().inbox).toHaveLength(1)
    expect(scheduler.pending()).toBe(1) // one TTL timer per buffered entry
    expect(run.getState().context.paymentId).toBeUndefined()

    // The user finishes the review 2 minutes later: the wait enters and drains the inbox first.
    scheduler.advance(2 * MINUTE)
    expect(await run.next()).toMatchObject({ ok: true, to: 'awaitPayment' })
    expect(eventsOfType('event.delivered')[0]).toMatchObject({
      event: 'payment.captured',
      to: 'awaitPayment',
    })
    expect(run.getState().inbox).toEqual([])
    expect(run.getState().steps.awaitPayment.status).toBe('done')
    expect(run.getState().status).toBe('done')
    expect(run.getState().output).toBe('paid (pay_1)')
    expect(scheduler.pending()).toBe(0) // TTL timer cleared with the entry, timeout never armed
    run.dispose()
  })

  it('dedupes a webhook id while buffered and after its payment completes the run', async () => {
    const { run, eventsOfType } = make()
    await run.start()
    expect(await run.send('payment.captured', goodBody, { eventId: 'wh-77' })).toMatchObject({
      ok: true,
      buffered: true,
    })
    expect(await run.send('payment.captured', goodBody, { eventId: 'wh-77' })).toMatchObject({
      ok: true,
      duplicate: true,
      delivered: [],
      buffered: false,
    })
    expect(run.getState().inbox).toHaveLength(1)

    await run.next()
    expect(run.getState().output).toBe('paid (pay_1)')
    expect(await run.send('payment.captured', goodBody, { eventId: 'wh-77' })).toMatchObject({
      ok: true,
      duplicate: true,
      delivered: [],
    })
    expect(eventsOfType('event.received')).toHaveLength(1)
    expect(eventsOfType('event.delivered')).toHaveLength(1)
    run.dispose()
  })

  it('expires a buffered event after its TTL, then times out the idle wait step', async () => {
    const { run, scheduler, eventsOfType } = make()
    await run.start()
    await run.send('payment.captured', goodBody)
    scheduler.advance(10 * MINUTE)
    expect(eventsOfType('event.expired')[0]).toMatchObject({ event: 'payment.captured' })
    expect(run.getState().inbox).toEqual([])

    await run.next() // the wait enters with an empty inbox → the 30-minute timeout is armed
    expect(run.getState().steps.awaitPayment).toMatchObject({
      status: 'active',
      deadline: T0 + 40 * MINUTE,
    })
    scheduler.advance(30 * MINUTE - 1)
    expect(run.getState().status).toBe('waiting')
    scheduler.advance(1)
    expect(eventsOfType('timer.fired').at(-1)).toMatchObject({ timerId: 'wait:awaitPayment' })
    expect(run.getState().steps.awaitPayment.output).toBeUndefined()
    expect(run.getState().output).toBe('expired: no payment within 30 minutes')
    run.dispose()
  })

  it('routes a failed payment to the declared decline target and rejects unknown wire events', async () => {
    const { run } = make()
    await run.start()
    await run.next()
    // The wire door runs the same boundary and answers with a CommandResult.
    expect(
      await run.dispatch({ type: 'send', event: 'payment.captured', payload: badBody }),
    ).toMatchObject({ ok: false, code: 'BOUNDARY_REJECTED' })
    // Typed send calls reject unknown names at compile time. Decode unknown wire data first.
    expect(
      parseCommand(checkoutFlow, {
        type: 'send',
        event: 'payment.refunded',
        payload: {},
      }),
    ).toMatchObject({ ok: false, issues: [{ path: ['event'] }] })
    expect(await run.send('payment.failed', { reason: 'insufficient funds' })).toMatchObject({
      ok: true,
      delivered: ['awaitPayment'],
    })
    expect(run.getState().steps.awaitPayment.status).toBe('done')
    expect(run.getState().steps.awaitPayment.output).toEqual({ reason: 'insufficient funds' })
    expect(run.getState().steps.declined.status).toBe('done')
    expect(run.getState().steps.paid).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    expect(run.getState().output).toBe('declined: insufficient funds')
    run.dispose()
  })

  it('drops an event whose correlation id belongs to another order', async () => {
    const { run, eventsOfType } = make()
    await run.start()
    await run.next() // the wait step listens
    // Same event name, valid body, but correlate('payment.captured') → 'o-2' ≠ this run's 'o-1'.
    const foreign = await run.send('payment.captured', {
      paymentId: 'pay_9',
      amount: 1,
      orderId: 'o-2',
    })
    expect(foreign).toMatchObject({ ok: false, reason: 'dropped' })
    expect(eventsOfType('event.dropped').at(-1)).toMatchObject({
      event: 'payment.captured',
      reason: 'correlation',
    })
    expect(run.getState().steps.awaitPayment.status).toBe('active')
    expect(run.getState().inbox).toEqual([])
    // Ours goes through.
    expect(await run.send('payment.captured', goodBody)).toMatchObject({ ok: true })
    expect(run.getState().status).toBe('done')
    run.dispose()
  })

  it('lets a flow-level order.cancelled handler cancel from any step', async () => {
    const { run, eventsOfType } = make()
    await run.start() // the cursor is on the review view, no wait step listens
    expect(await run.send('order.cancelled', { orderId: 'o-1', reason: 'customer' })).toMatchObject(
      {
        ok: true,
      },
    )
    expect(eventsOfType('flow.cancelled').length).toBe(1)
    expect(run.getState().status).toBe('cancelled')
    // Later webhooks bounce off a terminal flow (a value, not a throw).
    expect(await run.send('payment.captured', goodBody)).toMatchObject({ ok: false })
    run.dispose()
  })
})
