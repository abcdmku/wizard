/**
 * The runs the guide diagrams and the home page let a reader drive. Each example creates the
 * wizard its page shows, from `packages/docs/snippets`, with services the reader answers.
 */
import { type RefundDeps, refund } from '../../../snippets/agents/refund'
import { delivery } from '../../../snippets/learn/branch'
import { checkout } from '../../../snippets/learn/children'
import { type TripDeps, trip } from '../../../snippets/learn/compensate'
import { price } from '../../../snippets/learn/fallback'
import { signup } from '../../../snippets/learn/form'
import { dashboard } from '../../../snippets/learn/needs'
import { upload } from '../../../snippets/learn/retry'
import { report } from '../../../snippets/learn/steps'
import { approval } from '../../../snippets/learn/wait'
import type { LiveSpec } from './live'

const steps: LiveSpec = {
  label: 'A run from start to finish',
  wizard: report,
  call: "const run = report.create({ reportId: 'r-1' }, { deps })",
  create: ({ clock, service }) =>
    report.create(
      { reportId: 'r-1' },
      {
        clock,
        scheduler: clock,
        deps: { reports: { download: service('reports.download', () => ({ pages: 3 })) } },
      },
    ),
}

const needs: LiveSpec = {
  label: 'Two steps feed a third',
  wizard: dashboard,
  call: "const run = dashboard.create({ userId: '7' })",
  create: ({ clock }) => dashboard.create({ userId: '7' }, { clock, scheduler: clock }),
}

const forms: LiveSpec = {
  label: 'A form',
  wizard: signup,
  call: 'const run = signup.create({})',
  create: ({ clock }) => signup.create({}, { clock, scheduler: clock }),
  drafts: { contact: { email: 'not-an-email' } },
}

const branchTo = (speed: 'express' | 'standard'): LiveSpec => ({
  label: speed === 'express' ? 'Express' : 'Standard',
  wizard: delivery,
  call: `const run = delivery.create({ speed: '${speed}' })`,
  create: ({ clock }) => delivery.create({ speed }, { clock, scheduler: clock }),
})

const wait: LiveSpec = {
  label: 'An event with a deadline',
  wizard: approval,
  call: 'const run = approval.create({}, { scheduler })',
  create: ({ clock }) => approval.create({}, { clock, scheduler: clock }),
  payloads: { approved: { by: 'Grace' } },
}

const saveResume: LiveSpec = {
  label: 'Stop the process and resume',
  wizard: signup,
  call: "const run = signup.create({}, { store, instanceId: 'signup-1' })",
  create: ({ clock, store }) =>
    signup.create({}, { clock, scheduler: clock, store, instanceId: 'signup-1' }),
  drafts: { contact: { email: 'ada@example.com' } },
  resume: {
    key: 'signup-1',
    call: "const run = signup.resume(await store.get('signup-1'), { store })",
    run: ({ clock, store }, snapshot) =>
      signup.resume(snapshot as Parameters<typeof signup.resume>[0], {
        clock,
        scheduler: clock,
        store,
      }),
  },
}

const children: LiveSpec = {
  label: 'A child wizard as one step',
  wizard: checkout,
  call: "const run = checkout.create({ country: 'NL' })",
  create: ({ clock }) => checkout.create({ country: 'NL' }, { clock, scheduler: clock }),
  drafts: { street: { street: 'Keizersgracht 1' } },
}

const retry: LiveSpec = {
  label: 'A busy service',
  wizard: upload,
  call: "const run = upload.create({ fileId: 'f-1' }, { deps })",
  create: ({ clock, service }) =>
    upload.create(
      { fileId: 'f-1' },
      {
        clock,
        scheduler: clock,
        deps: {
          storage: {
            save: service(
              'storage.save',
              (fileId: string) => ({ url: `/files/${fileId}` }),
              'storage is busy',
            ),
          },
        },
      },
    ),
}

const fallback: LiveSpec = {
  label: 'A service that may be down',
  wizard: price,
  call: "const run = price.create({ sku: 'sku-1', listPrice: 10 }, { deps })",
  create: ({ clock, service }) =>
    price.create(
      { sku: 'sku-1', listPrice: 10 },
      {
        clock,
        scheduler: clock,
        deps: { live: { price: service('live.price', (_sku: string) => 12, 'pricing is down') } },
      },
    ),
}

const compensate: LiveSpec = {
  label: 'Book a trip',
  wizard: trip,
  call: "const run = trip.create({ tripId: 't-1' }, { deps })",
  create: ({ clock, service }) => {
    const deps: TripDeps = {
      flights: {
        book: service('flights.book', (_tripId: string) => ({ ref: 'FL-1' }), 'no seats left'),
        cancel: service('flights.cancel', (_ref: string) => undefined),
      },
      hotels: {
        book: service('hotels.book', (_tripId: string) => ({ ref: 'HT-1' }), 'hotel is full'),
      },
    }
    return trip.create({ tripId: 't-1' }, { clock, scheduler: clock, deps })
  },
}

const refundSpec: LiveSpec = {
  label: 'A refund',
  wizard: refund,
  call: "const run = refund.create({ orderId: 'o-2' }, { deps })",
  create: ({ clock, service }) => {
    const deps: RefundDeps = {
      orders: { find: service('orders.find', (_orderId: string) => ({ total: 250 })) },
      payments: {
        refund: service(
          'payments.refund',
          (_orderId: string, _amount: number) => ({ refundId: 'refund-1' }),
          'card declined',
        ),
      },
    }
    return refund.create({ orderId: 'o-2' }, { clock, scheduler: clock, deps })
  },
  drafts: { request: { amount: 900, reason: 'never arrived' } },
  payloads: { 'refund.approved': { by: 'grace' } },
}

/** Examples by the name a page passes to `<RunDiagram name="..." />`. */
export const liveSpecs: Readonly<Record<string, readonly LiveSpec[]>> = {
  steps: [steps],
  needs: [needs],
  forms: [forms],
  branch: [branchTo('express'), branchTo('standard')],
  wait: [wait],
  'save-resume': [saveResume],
  children: [children],
  retry: [retry],
  fallback: [fallback],
  compensate: [compensate],
  refund: [refundSpec],
}
