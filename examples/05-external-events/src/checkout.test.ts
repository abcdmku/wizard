import { createWizard, isWizardError, type WizardEvent } from '@openwizard/core'
import { createTestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import { checkout } from './checkout'

const MINUTE = 60_000
const T0 = 1_000_000

function make() {
  const sched = createTestScheduler({ now: T0 })
  // `correlationId` = the order id: correlated events for another order are dropped.
  const wizard = createWizard(checkout, {
    context: { orderId: 'o-1' },
    correlationId: 'o-1',
    scheduler: sched,
  })
  const events: WizardEvent<typeof checkout>[] = []
  wizard.observe((e) => events.push(e))
  const of = <T extends WizardEvent['type']>(type: T) =>
    events.filter((e): e is Extract<WizardEvent<typeof checkout>, { type: T }> => e.type === type)
  return { wizard, sched, events, of }
}

// What a webhook endpoint receives: `unknown` bodies.
const goodBody: unknown = { paymentId: 'pay_1', amount: 42, orderId: 'o-1' }
const badBody: unknown = { paymentId: 42, amount: -1 }

describe('05 external events: send() through the event boundary, inbox, TTL, timeout', () => {
  it('rejects a bad payload as a value and delivers a good one to the active wait step', async () => {
    const { wizard, of } = make()
    await wizard.start()
    expect(await wizard.next()).toMatchObject({ ok: true, from: 'review', to: 'awaitPayment' })
    expect(wizard.getState().status).toBe('waiting')

    // The boundary rejects the payload: `event.rejected` + a result with the schema's issues.
    const rejected = await wizard.send('payment.captured', badBody)
    expect(rejected).toMatchObject({ ok: false, reason: 'rejected' })
    if (rejected.ok || rejected.reason !== 'rejected') throw new Error('unreachable')
    expect(rejected.issues.map((i) => i.path)).toEqual([['paymentId'], ['amount']])
    expect(of('event.rejected')[0]).toMatchObject({ event: 'payment.captured' })
    expect(wizard.getState().steps.awaitPayment.status).toBe('active') // nothing changed
    expect(wizard.getState().context.paymentId).toBeUndefined()

    // A good one is delivered to the listening wait step; the handler ran; the step completed.
    const delivered = await wizard.send('payment.captured', goodBody, { correlationId: 'wh-77' })
    expect(delivered).toMatchObject({ ok: true, delivered: ['awaitPayment'], buffered: false })
    expect(of('event.received')[0]).toMatchObject({
      event: 'payment.captured',
      correlationId: 'wh-77',
      payload: { paymentId: 'pay_1', amount: 42, orderId: 'o-1' },
    })
    expect(of('event.delivered')[0]).toMatchObject({
      event: 'payment.captured',
      to: 'awaitPayment',
    })
    expect(wizard.getState().context.paymentId).toBe('pay_1')
    expect(wizard.getState().steps.awaitPayment).toMatchObject({
      status: 'done',
      output: {
        event: 'payment.captured',
        payload: { paymentId: 'pay_1', amount: 42, orderId: 'o-1' },
      },
    })
    expect(wizard.getState().status).toBe('done')
    expect(wizard.getState().output).toBe('paid (pay_1)')
    expect(wizard.getState().timers).toEqual({}) // the 30-minute timeout was cleared

    // Terminal: a late webhook is dropped (a value), never thrown.
    expect(await wizard.send('payment.captured', goodBody)).toMatchObject({
      ok: false,
      reason: 'dropped',
    })
    wizard.dispose()
  })

  it('buffers an EARLY event in the inbox and delivers it when the wait step enters', async () => {
    const { wizard, sched, of } = make()
    await wizard.start()
    expect(wizard.getState().current).toBe('review') // nobody listens yet

    const early = await wizard.send('payment.captured', goodBody)
    expect(early).toMatchObject({ ok: true, delivered: [], buffered: true })
    expect(of('event.buffered')[0]).toMatchObject({
      event: 'payment.captured',
      expiresAt: T0 + 10 * MINUTE,
    })
    expect(wizard.getState().inbox).toHaveLength(1)
    expect(sched.pending()).toBe(1) // one TTL timer per buffered entry
    expect(wizard.getState().context.paymentId).toBeUndefined()

    // The user finishes the review 2 minutes later: the wait enters and drains the inbox first.
    sched.advance(2 * MINUTE)
    expect(await wizard.next()).toMatchObject({ ok: true, to: 'awaitPayment' })
    expect(of('event.delivered')[0]).toMatchObject({
      event: 'payment.captured',
      to: 'awaitPayment',
    })
    expect(wizard.getState().inbox).toEqual([])
    expect(wizard.getState().steps.awaitPayment.status).toBe('done')
    expect(wizard.getState().status).toBe('done')
    expect(wizard.getState().output).toBe('paid (pay_1)')
    expect(sched.pending()).toBe(0) // TTL timer cleared with the entry, timeout never armed
    wizard.dispose()
  })

  it('expires a buffered event after its TTL; an idle wait then times out', async () => {
    const { wizard, sched, of } = make()
    await wizard.start()
    await wizard.send('payment.captured', goodBody)
    sched.advance(10 * MINUTE)
    expect(of('event.expired')[0]).toMatchObject({ event: 'payment.captured' })
    expect(wizard.getState().inbox).toEqual([])

    await wizard.next() // the wait enters with an empty inbox → the 30-minute timeout is armed
    expect(wizard.getState().steps.awaitPayment).toMatchObject({
      status: 'active',
      deadline: T0 + 40 * MINUTE,
    })
    sched.advance(30 * MINUTE - 1)
    expect(wizard.getState().status).toBe('waiting')
    sched.advance(1)
    expect(of('timer.fired').at(-1)).toMatchObject({ timerId: 'wait:awaitPayment' })
    expect(wizard.getState().steps.awaitPayment.output).toEqual({ event: 'timeout' })
    expect(wizard.getState().output).toBe('expired: no payment within 30 minutes')
    wizard.dispose()
  })

  it('a handler may override the target; unknown event names are programmer errors; dispatch() is the wire door', async () => {
    const { wizard } = make()
    await wizard.start()
    await wizard.next()
    // The wire door runs the same boundary and answers with a CommandResult.
    expect(
      await wizard.dispatch({ type: 'send', event: 'payment.captured', payload: badBody }),
    ).toMatchObject({ ok: false, code: 'BOUNDARY_REJECTED' })
    // Undeclared event → WizardError('UNKNOWN_EVENT') (the types already prevent this).
    await expect(wizard.send('payment.refunded' as never, {})).rejects.toSatisfy(
      (e: unknown) => isWizardError(e) && e.code === 'UNKNOWN_EVENT',
    )
    expect(await wizard.send('payment.failed', { reason: 'insufficient funds' })).toMatchObject({
      ok: true,
      delivered: ['awaitPayment'],
    })
    expect(wizard.getState().steps.awaitPayment.status).toBe('done')
    expect(wizard.getState().steps.declined.status).toBe('done')
    expect(wizard.getState().output).toBe('declined: insufficient funds')
    wizard.dispose()
  })

  it('correlation: a webhook for ANOTHER order is dropped, never buffered or delivered', async () => {
    const { wizard, of } = make()
    await wizard.start()
    await wizard.next() // the wait step listens
    // Same event name, valid body, but correlate('payment.captured') → 'o-2' ≠ this wizard's 'o-1'.
    const foreign = await wizard.send('payment.captured', {
      paymentId: 'pay_9',
      amount: 1,
      orderId: 'o-2',
    })
    expect(foreign).toMatchObject({ ok: false, reason: 'dropped' })
    expect(of('event.dropped').at(-1)).toMatchObject({
      event: 'payment.captured',
      reason: 'correlation',
    })
    expect(wizard.getState().steps.awaitPayment.status).toBe('active')
    expect(wizard.getState().inbox).toEqual([])
    // Ours goes through.
    expect(await wizard.send('payment.captured', goodBody)).toMatchObject({ ok: true })
    expect(wizard.getState().status).toBe('done')
    wizard.dispose()
  })

  it('flow-level on: an order.cancelled webhook cancels the flow from any step', async () => {
    const { wizard, of } = make()
    await wizard.start() // the cursor is on the review view — no wait step listens
    expect(
      await wizard.send('order.cancelled', { orderId: 'o-1', reason: 'customer' }),
    ).toMatchObject({
      ok: true,
    })
    expect(of('flow.cancelled').length).toBe(1)
    expect(wizard.getState().status).toBe('cancelled')
    // Later webhooks bounce off a terminal flow (a value, not a throw).
    expect(await wizard.send('payment.captured', goodBody)).toMatchObject({ ok: false })
    wizard.dispose()
  })
})
