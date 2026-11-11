import { expect, it } from 'vitest'
import { type RefundDeps, refund, refundPage } from './refund'

function deps(): RefundDeps & { readonly refunds: number[] } {
  const refunds: number[] = []
  return {
    refunds,
    orders: { find: async () => ({ total: 250 }) },
    payments: {
      refund: async (_orderId, amount) => {
        refunds.push(amount)
        return { refundId: `refund-${refunds.length}` }
      },
    },
  }
}

it('pays a small refund without a manager', async () => {
  const services = deps()
  const run = refund.create({ orderId: 'o-1' }, { deps: services })
  try {
    await run.start()
    await run.setInput('request', { amount: 40, reason: 'damaged' })
    expect(await run.next()).toMatchObject({ ok: true })

    expect(await run.awaitResult()).toMatchObject({
      status: 'done',
      output: { refundId: 'refund-1', amount: 40, approvedBy: 'policy' },
    })
    expect(run.getState().steps.managerApproval.status).toBe('skipped')
  } finally {
    run.dispose()
  }
})

it('holds a large refund until a manager approves it', async () => {
  const services = deps()
  const run = refund.create({ orderId: 'o-2' }, { deps: services })
  try {
    await run.start()
    await run.setInput('request', { amount: 900, reason: 'never arrived' })
    await run.next()
    await run.whenIdle()

    expect(run.waitingFor()).toMatchObject([
      { kind: 'event', step: 'managerApproval', events: ['refund.approved'] },
    ])
    expect(services.refunds).toEqual([])

    await run.send('refund.approved', { by: 'grace' })
    expect(await run.awaitResult()).toMatchObject({
      status: 'done',
      output: { refundId: 'refund-1', amount: 250, approvedBy: 'grace' },
    })
  } finally {
    run.dispose()
  }
})

it('renders the wizard as a page', () => {
  expect(refundPage).toContain(
    'Refunds part of an order. A refund of 100 or more waits for a manager.',
  )
  expect(refundPage).toContain(
    '| `pay` | step | `request` finishes; `order` finishes; the first of `managerApproval` or `policyApproval` finishes | Runs work | ends its branch, and its output can be the result |',
  )
})
