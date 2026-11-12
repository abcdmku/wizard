/**
 * The dev config behind each live portal on the site. Every wizard comes from
 * `packages/docs/snippets`, so the portal runs the code its page shows.
 */
import { type DevConfig, defineDev, devWizard } from '@openwizard/dev'
import { refund } from '../../../snippets/agents/refund'
import devConfig from '../../../snippets/dev/openwizard.dev'
import { delivery } from '../../../snippets/learn/branch'
import { checkout } from '../../../snippets/learn/children'
import { trip } from '../../../snippets/learn/compensate'
import { price } from '../../../snippets/learn/fallback'
import { signup } from '../../../snippets/learn/form'
import { dashboard } from '../../../snippets/learn/needs'
import { upload } from '../../../snippets/learn/retry'
import { report } from '../../../snippets/learn/steps'
import { approval } from '../../../snippets/learn/wait'

/** One portal: the file its wizards come from and what the UI loads. */
export interface PortalSpec {
  /** Shown in the top bar, where the dev server shows its entry file. */
  readonly file: string
  readonly config: DevConfig
}

const one = (file: string, wizard: DevConfig['wizards'][number]): PortalSpec => ({
  file,
  config: defineDev({ wizards: [wizard] }),
})

/** Portals by the name a page passes to `<Portal name="..." />`. */
export const portals: Readonly<Record<string, PortalSpec>> = {
  dev: { file: 'dev/openwizard.dev.ts', config: devConfig },
  refund: one(
    'agents/refund.ts',
    devWizard(refund, {
      input: { orderId: 'o-2' },
      events: { 'refund.approved': { source: 'webhook', from: 'Back office' } },
      examples: {
        forms: { request: { amount: 900, reason: 'never arrived' } },
        events: { 'refund.approved': { by: 'grace' } },
        calls: { 'orders.find': { total: 250 }, 'payments.refund': { refundId: 'refund-1' } },
      },
    }),
  ),
  steps: one(
    'learn/steps.ts',
    devWizard(report, {
      input: { reportId: 'r-1' },
      examples: { calls: { 'reports.download': { pages: 3 } } },
    }),
  ),
  needs: one('learn/needs.ts', devWizard(dashboard, { input: { userId: '7' } })),
  forms: one(
    'learn/form.ts',
    devWizard(signup, { examples: { forms: { contact: { email: 'not-an-email' } } } }),
  ),
  branch: one('learn/branch.ts', devWizard(delivery, { input: { speed: 'express' } })),
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
