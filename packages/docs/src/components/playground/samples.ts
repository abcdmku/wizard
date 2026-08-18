/**
 * What the editors open with. The landing IDE shows example 01 split into three files; the
 * playground can load every runnable example VERBATIM (`?raw` imports of the tested sources —
 * nothing is hand-copied, so the playground can never drift from the repository).
 */

import onboardingMain from '../../../../../examples/01-happy-path/src/main.ts?raw'
import onboardingFlow from '../../../../../examples/01-happy-path/src/onboarding.ts?raw'
import syncInvoiceMain from '../../../../../examples/02-recoverable-failure/src/main.ts?raw'
import syncInvoiceFlow from '../../../../../examples/02-recoverable-failure/src/sync-invoice.ts?raw'
import bookTripFlow from '../../../../../examples/03-non-recoverable-compensation/src/book-trip.ts?raw'
import bookTripMain from '../../../../../examples/03-non-recoverable-compensation/src/main.ts?raw'
import approvalFlow from '../../../../../examples/04-resume-from-snapshot/src/approval.ts?raw'
import approvalMain from '../../../../../examples/04-resume-from-snapshot/src/main.ts?raw'
import checkoutFlow from '../../../../../examples/05-external-events/src/checkout.ts?raw'
import checkoutMain from '../../../../../examples/05-external-events/src/main.ts?raw'
import orderMain from '../../../../../examples/06-nested-flow/src/main.ts?raw'
import orderFlow from '../../../../../examples/06-nested-flow/src/order.ts?raw'
import pipelineMain from '../../../../../examples/07-dag-pipeline/src/main.ts?raw'
import pipelineFlow from '../../../../../examples/07-dag-pipeline/src/pipeline.ts?raw'
import mermaidFlow from '../../../../../examples/09-mermaid/src/checkout.ts?raw'
import mermaidMain from '../../../../../examples/09-mermaid/src/main.ts?raw'

export interface PlaygroundFile {
  readonly name: string
  readonly content: string
}

export interface PlaygroundSample {
  readonly id: string
  readonly title: string
  readonly entry: string
  readonly files: readonly PlaygroundFile[]
}

const LANDING_MAIN = `// Press Run: this file is imported as a real ES module against the real @openwizard/core.
// Every wizard it creates is observed by the preview (Graph · Trace · Explain), and
// console output lands in the Console tab.
import { createWizard } from '@openwizard/core'
import { deps } from './deps'
import { onboarding } from './flow'

const wizard = createWizard(onboarding, { context: { email: 'ada@example.com' }, deps })

await wizard.start() //            → the cursor is on 'profile'
await wizard.next() //             → { ok: false, code: 'INVALID_INPUT', issues } — a value, not a throw
await wizard.setInput('profile', { company: 'Acme', role: 'engineer' })
await wizard.next() //             → { ok: true, from: 'profile', to: 'save' }; task ran; flow done

const state = wizard.getState()
state.steps.save.output //         { id: string } | undefined — typed from the task's run (hover it)
state.output //                    string | undefined — typed from the final step
console.log(state.status, wizard.explain('save'))
`

const LANDING_DEPS = `import type { Deps } from './flow'

/** The CRM the \`save\` task calls — an in-memory fake here; the host builds the real one. */
export const deps: Deps = {
  crm: { upsert: (contact) => ({ id: \`crm_\${contact.email}\` }) },
}
`

/** Example 01 as three files: the flow verbatim, its deps, and a `main.ts` that drives it. */
export const landingSample: PlaygroundSample = {
  id: 'landing',
  title: 'Onboarding (example 01)',
  entry: 'main.ts',
  files: [
    { name: 'flow.ts', content: onboardingFlow },
    { name: 'main.ts', content: LANDING_MAIN },
    { name: 'deps.ts', content: LANDING_DEPS },
  ],
}

const example = (
  id: string,
  title: string,
  flowFile: string,
  flow: string,
  main: string,
): PlaygroundSample => ({
  id,
  title,
  entry: 'main.ts',
  files: [
    { name: flowFile, content: flow },
    { name: 'main.ts', content: main },
  ],
})

/** The runnable examples, verbatim (08 is a React app and lives on its own page). */
export const exampleSamples: readonly PlaygroundSample[] = [
  example('01-happy-path', '01 — happy path', 'onboarding.ts', onboardingFlow, onboardingMain),
  example(
    '02-recoverable-failure',
    '02 — recoverable failure',
    'sync-invoice.ts',
    syncInvoiceFlow,
    syncInvoiceMain,
  ),
  example(
    '03-non-recoverable-compensation',
    '03 — compensation',
    'book-trip.ts',
    bookTripFlow,
    bookTripMain,
  ),
  example(
    '04-resume-from-snapshot',
    '04 — resume from snapshot',
    'approval.ts',
    approvalFlow,
    approvalMain,
  ),
  example('05-external-events', '05 — external events', 'checkout.ts', checkoutFlow, checkoutMain),
  example('06-nested-flow', '06 — nested flow', 'order.ts', orderFlow, orderMain),
  example('07-dag-pipeline', '07 — DAG pipeline', 'pipeline.ts', pipelineFlow, pipelineMain),
  example('09-mermaid', '09 — mermaid', 'checkout.ts', mermaidFlow, mermaidMain),
]

export const allSamples: readonly PlaygroundSample[] = [landingSample, ...exampleSamples]
