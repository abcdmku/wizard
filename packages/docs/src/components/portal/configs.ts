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

/** One portal: the file its wizards come from, what the UI loads and what to try. */
export interface PortalSpec {
  /** Shown in the top bar, where the dev server shows its entry file. */
  readonly file: string
  readonly config: DevConfig
  /** What a reader does to see the point of the page, in order. */
  readonly tries: readonly string[]
  /** False to open on the wizard, so the reader picks the input. A run starts otherwise. */
  readonly autostart?: false
}

const one = (
  file: string,
  wizard: DevConfig['wizards'][number],
  tries: readonly string[],
  autostart?: false,
): PortalSpec => ({
  file,
  config: defineDev({ wizards: [wizard] }),
  tries,
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
    tries: [
      'Pick a wizard in the list.',
      'Press Start run.',
      'Answer what the run waits for: a form, an event, a service call or a timer.',
      'Idea: In deploy, skip the 10 minute bake, then return 0.2 to metrics.errorRate. The run calls cluster.rollback to undo the canary.',
      'Idea: In incident, skip the 5 minute timeout on ack. The page goes to the manager.',
    ],
  },
  dev: {
    file: 'dev/openwizard.dev.ts',
    config: devConfig,
    autostart: false,
    tries: [
      'Press Start run. orders.find is a configured service, so the order step answers on its own.',
      'Press Submit form, then Send refund.approved: the webhook the manager step waits for.',
      'Return payments.refund, or press Make it throw, then Throw. pay tries again.',
    ],
  },
  refund: one('agents/refund.ts', refundWizard, [
    'Press Return on orders.find, then Submit form. A refund of 900 goes to a manager.',
    'Press Send refund.approved, then Return on payments.refund.',
  ]),
  steps: one(
    'learn/steps.ts',
    devWizard(report, {
      input: { reportId: 'r-1' },
      examples: { calls: { 'reports.download': { pages: 3 } } },
    }),
    [
      'The run stops at download, which called deps.reports.download. Press Return to answer it.',
      'announce starts because download named it in next. Its output is the result of the run.',
      'Open History to see each step start and finish, in order.',
    ],
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
    [
      'profile and orders both run, because both start the wizard. Return one of the two calls.',
      'summary stays blocked. It starts only when both have finished.',
      'Return the other call, then click summary in the graph to see the output it built from both.',
    ],
  ),
  forms: one(
    'learn/form.ts',
    devWizard(signup, { examples: { forms: { contact: { email: 'not-an-email' } } } }),
    [
      'Submit the form as it is. The schema refuses the email and the run stays on contact.',
      'Enter a real address and submit again. welcome reads it through needs.',
    ],
  ),
  branch: one(
    'learn/branch.ts',
    devWizard(delivery, { input: { speed: 'express' } }),
    [
      'Start a run with speed express. choose starts express and skips standard.',
      'Open delivery in the list, pick standard and press Start run. The other branch runs and label still gets a value.',
    ],
    false,
  ),
  wait: one(
    'learn/wait.ts',
    devWizard(approval, { examples: { events: { approved: { by: 'Grace' } } } }),
    [
      'The run waits at decision for the approved event. Press Send approved.',
      'Press New run, then Skip to it on the timer. 48 hours pass, decision is skipped and close runs.',
      'Press New run. Clear by and press Send approved. The schema refuses the payload and the step keeps waiting.',
    ],
  ),
  'save-resume': one(
    'learn/form.ts',
    devWizard(signup, { examples: { forms: { contact: { email: 'ada@example.com' } } } }),
    [
      'Open the Snapshot tab. That JSON is the whole run, and it is what a store keeps.',
      'Open More and press Restart from snapshot. The run is rebuilt from that JSON and the form still waits.',
      'Submit the form. The resumed run finishes.',
    ],
  ),
  children: one(
    'learn/children.ts',
    devWizard(checkout, {
      input: { country: 'NL' },
      examples: { forms: { street: { street: 'Keizersgracht 1' } } },
    }),
    [
      'shipping is a whole wizard running as one step. Its form shows as "shipping / street".',
      'Submit it. The output of the child becomes the output of shipping, and confirm reads it.',
      'Open Snapshot. The child run is stored inside the parent.',
    ],
  ),
  retry: one(
    'learn/retry.ts',
    devWizard(upload, {
      input: { fileId: 'f-1' },
      examples: { calls: { 'storage.save': { url: '/files/f-1' } } },
    }),
    [
      'Press Make it throw, then Throw, on storage.save. The step goes to "retrying" and a one second timer starts.',
      'The call comes back with the same idempotency key. Throw twice more and the run halts.',
      'Press Retry on the failed step, then Return.',
    ],
  ),
  fallback: one(
    'learn/fallback.ts',
    devWizard(price, {
      input: { sku: 'sku-1', listPrice: 10 },
      examples: { calls: { 'live.price': 12 } },
    }),
    [
      'Press Make it throw, then Throw, on live.price. The run does not halt. live is skipped and list starts.',
      'quote reads the list price. Press New run, then Return, to see it read the live price.',
    ],
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
    [
      'Return flights.book. The flight is booked.',
      'Press Make it throw, then Throw, on hotels.book. The run calls flights.cancel with the reference you returned.',
      'Return flights.cancel. The run ends as failed, with the flight undone.',
    ],
  ),
}
