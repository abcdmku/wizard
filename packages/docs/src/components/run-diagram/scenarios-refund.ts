/** The run the landing page replays: a form, parallel work, a branch, an event wait and a join. */
import { type RefundDeps, refund } from '../../../snippets/agents/refund'
import type { Scenario } from './record'
import { deferred } from './support'

const refundOf = (amount: number): Scenario => ({
  label: amount >= 100 ? 'A large refund' : 'A small refund',
  wizard: refund,
  async play(tape) {
    const order = deferred<{ total: number }>()
    const deps: RefundDeps = {
      orders: { find: () => order.promise },
      payments: { refund: async () => ({ refundId: 'refund-1' }) },
    }
    const run = refund.create({ orderId: 'o-2' }, { deps })
    tape.track(run)
    await tape.beat(
      "const run = refund.create({ orderId: 'o-2' }, { deps })",
      'No step has started.',
    )
    await tape.beat(
      'await run.start()',
      'Two steps start together. request waits for the customer, and order loads from your service.',
      () => run.start(),
    )
    await tape.beat(
      `await run.setInput('request', { amount: ${amount}, reason: 'never arrived' })`,
      'The customer fills in the form. The draft is saved with the run.',
      () => run.setInput('request', { amount, reason: 'never arrived' }),
    )
    await tape.beat(
      'await run.next()',
      amount >= 100
        ? 'The form is valid. route sends a refund of 100 or more to a manager, and the run waits for that event.'
        : 'The form is valid. route approves a refund under 100 by policy and skips the manager.',
      () => run.next(),
    )
    await tape.beat(
      '// deps.orders.find resolves',
      amount >= 100
        ? 'The order is loaded. pay still needs an approval, so it does not start.'
        : 'The order is loaded. pay has the request, the order and an approval, so it runs.',
      () => order.resolve({ total: 250 }),
    )
    if (amount >= 100) {
      await tape.beat(
        "await run.send('refund.approved', { by: 'grace' })",
        'The event ends the wait. pay now has all three needs and returns the money.',
        () => run.send('refund.approved', { by: 'grace' }),
      )
    }
    await tape.beat('await run.awaitResult()', 'The output of pay is the result of the run.', () =>
      run.awaitResult(),
    )
    run.dispose()
  },
})

export const refundScenarios: Readonly<Record<string, readonly Scenario[]>> = {
  refund: [refundOf(900), refundOf(40)],
}
