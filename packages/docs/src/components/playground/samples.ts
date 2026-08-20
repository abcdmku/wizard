/**
 * The playground imports the tested example sources verbatim. The landing IDE opens the backend
 * order flow because that is the shortest path to the product's main use case.
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
import backendOrderMain from '../../../../../examples/11-order-workflow/src/main.ts?raw'
import backendOrderFlow from '../../../../../examples/11-order-workflow/src/order-workflow.ts?raw'

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

/** Example 11 as the landing sample: a backend order, retry, snapshot, and typed webhook. */
export const landingSample: PlaygroundSample = {
  id: 'landing',
  title: 'Backend order (example 11)',
  entry: 'main.ts',
  files: [
    { name: 'order-workflow.ts', content: backendOrderFlow },
    { name: 'main.ts', content: backendOrderMain },
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
  example(
    '11-order-workflow',
    '11 - backend order workflow',
    'order-workflow.ts',
    backendOrderFlow,
    backendOrderMain,
  ),
  example('01-happy-path', '01 - happy path', 'onboarding.ts', onboardingFlow, onboardingMain),
  example(
    '02-recoverable-failure',
    '02 - recoverable failure',
    'sync-invoice.ts',
    syncInvoiceFlow,
    syncInvoiceMain,
  ),
  example(
    '03-non-recoverable-compensation',
    '03 - compensation',
    'book-trip.ts',
    bookTripFlow,
    bookTripMain,
  ),
  example(
    '04-resume-from-snapshot',
    '04 - resume from snapshot',
    'approval.ts',
    approvalFlow,
    approvalMain,
  ),
  example('05-external-events', '05 - external events', 'checkout.ts', checkoutFlow, checkoutMain),
  example('06-nested-flow', '06 - nested flow', 'order.ts', orderFlow, orderMain),
  example(
    '07-dag-pipeline',
    '07 - parallel work and joins',
    'pipeline.ts',
    pipelineFlow,
    pipelineMain,
  ),
  example('09-mermaid', '09 - mermaid', 'checkout.ts', mermaidFlow, mermaidMain),
]

export const allSamples: readonly PlaygroundSample[] = [landingSample, ...exampleSamples]
