/**
 * The dev config behind each live portal on the site, and what a reader should try in it.
 * Every wizard comes from `packages/docs/snippets`, so the portal runs the code its page shows.
 */
import { type DevConfig, defineDev, devWizard } from '@openwizard/dev'
import { refund } from '../../../snippets/agents/refund'
import devConfig from '../../../snippets/dev/openwizard.dev'
import { deploy } from '../../../snippets/home/deploy'
import { incident } from '../../../snippets/home/incident'
import { onboarding } from '../../../snippets/home/onboarding'
import { research } from '../../../snippets/home/research'
import { delivery } from '../../../snippets/learn/branch'
import { checkout } from '../../../snippets/learn/children'
import { trip } from '../../../snippets/learn/compensate'
import { price } from '../../../snippets/learn/fallback'
import { signup } from '../../../snippets/learn/form'
import { dashboard } from '../../../snippets/learn/needs'
import { upload } from '../../../snippets/learn/retry'
import { report } from '../../../snippets/learn/steps'
import { approval } from '../../../snippets/learn/wait'

/** One portal: the file its wizards come from, and what the UI loads. */
export interface PortalSpec {
  /** Shown in the top bar, where the dev server shows its entry file. */
  readonly file: string
  readonly config: DevConfig
  /** False to open on the wizard, so the reader picks the input. A run starts otherwise. */
  readonly autostart?: false
}

const one = (
  file: string,
  wizard: DevConfig['wizards'][number],
  autostart?: false,
): PortalSpec => ({
  file,
  config: defineDev({ wizards: [wizard] }),
  ...(autostart === false ? { autostart } : {}),
})

const refundWizard = devWizard(refund, {
  input: { orderId: 'o-2' },
  events: { 'refund.approved': { source: 'webhook', from: 'Back office' } },
  examples: {
    forms: { request: { amount: 900, reason: 'never arrived' } },
    events: { 'refund.approved': { by: 'grace' } },
    calls: { 'orders.find': { total: 250 }, 'payments.refund': { refundId: 'refund-1' } },
  },
})

/** Five wizards with little in common, so a reader sees how far one model stretches. */
const home = defineDev({
  wizards: [
    refundWizard,
    devWizard(research, {
      input: { question: 'Which laptop should the design team buy?' },
      examples: {
        forms: { review: { approve: true, note: '' } },
        calls: {
          'model.plan': { queries: ['laptops for designers', 'colour accurate displays'] },
          'search.run': 'Three models have a display that covers 100% of P3.',
          'model.write': 'Buy the 16 inch model. Its display covers 100% of P3.',
        },
      },
    }),
    devWizard(onboarding, {
      input: { name: 'Ada Example' },
      events: { 'laptop.delivered': { source: 'queue', from: 'courier topic' } },
      examples: {
        forms: { details: { team: 'engineering', startDate: '2027-01-11' } },
        events: { 'laptop.delivered': { tracking: 'TRACK-1' } },
        calls: {
          'directory.createAccount': { email: 'ada@example.com' },
          'it.orderLaptop': { orderId: 'IT-1' },
        },
      },
    }),
    devWizard(incident, {
      input: { service: 'checkout-api' },
      events: {
        'incident.acked': { source: 'webhook', from: 'Pager' },
        'incident.resolved': { source: 'webhook', from: 'Monitoring' },
      },
      examples: {
        events: {
          'incident.acked': { by: 'grace' },
          'incident.resolved': { fix: 'Rolled back release 42' },
        },
        calls: {
          'pager.page': { pageId: 'page-1' },
          'wiki.createPostmortem': { url: 'https://wiki.example.com/postmortems/1' },
        },
      },
    }),
    devWizard(deploy, {
      input: { version: '2.4.0' },
      examples: {
        calls: {
          'ci.build': { image: 'app:2.4.0' },
          'cluster.release': { releaseId: 'rel-1' },
          'cluster.rollback': null,
          'metrics.errorRate': 0.002,
        },
      },
    }),
  ],
})

/** Portals by the name a page passes to `<Portal name="..." />`. */
export const portals: Readonly<Record<string, PortalSpec>> = {
  home: {
    file: 'home/openwizard.dev.ts',
    config: home,
    autostart: false,
  },
  dev: {
    file: 'dev/openwizard.dev.ts',
    config: devConfig,
    autostart: false,
  },
  refund: one('agents/refund.ts', refundWizard),
  steps: one(
    'learn/steps.ts',
    devWizard(report, {
      input: { reportId: 'r-1' },
      examples: { calls: { 'reports.download': { pages: 3 } } },
    }),
  ),
  needs: one(
    'learn/needs.ts',
    devWizard(dashboard, {
      input: { userId: '7' },
      examples: {
        calls: {
          'users.find': { name: 'User 7' },
          'orders.list': [{ id: 'order-1' }, { id: 'order-2' }],
        },
      },
    }),
  ),
  forms: one(
    'learn/form.ts',
    devWizard(signup, { examples: { forms: { contact: { email: 'not-an-email' } } } }),
  ),
  branch: one('learn/branch.ts', devWizard(delivery, { input: { speed: 'express' } }), false),
  wait: one(
    'learn/wait.ts',
    devWizard(approval, { examples: { events: { approved: { by: 'Grace' } } } }),
  ),
  'save-resume': one(
    'learn/form.ts',
    devWizard(signup, { examples: { forms: { contact: { email: 'ada@example.com' } } } }),
  ),
  children: one(
    'learn/children.ts',
    devWizard(checkout, {
      input: { country: 'NL' },
      examples: { forms: { street: { street: 'Keizersgracht 1' } } },
    }),
  ),
  retry: one(
    'learn/retry.ts',
    devWizard(upload, {
      input: { fileId: 'f-1' },
      examples: { calls: { 'storage.save': { url: '/files/f-1' } } },
    }),
  ),
  fallback: one(
    'learn/fallback.ts',
    devWizard(price, {
      input: { sku: 'sku-1', listPrice: 10 },
      examples: { calls: { 'live.price': 12 } },
    }),
  ),
  compensate: one(
    'learn/compensate.ts',
    devWizard(trip, {
      input: { tripId: 't-1' },
      examples: {
        calls: {
          'flights.book': { ref: 'FL-1' },
          'flights.cancel': null,
          'hotels.book': { ref: 'HT-1' },
        },
      },
    }),
  ),
}
