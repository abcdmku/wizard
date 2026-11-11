/**
 * The playground imports the tested example sources verbatim. The landing IDE opens the backend
 * order wizard because that is the shortest path to the product's main use case.
 */

import helloSource from '../../../../../examples/01-happy-path/src/hello.ts?raw'
import helloMain from '../../../../../examples/01-happy-path/src/main.ts?raw'
import syncInvoiceMain from '../../../../../examples/02-recoverable-failure/src/main.ts?raw'
import syncInvoiceSource from '../../../../../examples/02-recoverable-failure/src/sync-invoice.ts?raw'
import bookTripSource from '../../../../../examples/03-non-recoverable-compensation/src/book-trip.ts?raw'
import bookTripMain from '../../../../../examples/03-non-recoverable-compensation/src/main.ts?raw'
import approvalSource from '../../../../../examples/04-resume-from-snapshot/src/approval.ts?raw'
import approvalMain from '../../../../../examples/04-resume-from-snapshot/src/main.ts?raw'
import checkoutSource from '../../../../../examples/05-external-events/src/checkout.ts?raw'
import checkoutMain from '../../../../../examples/05-external-events/src/main.ts?raw'
import orderMain from '../../../../../examples/06-nested-wizard/src/main.ts?raw'
import orderSource from '../../../../../examples/06-nested-wizard/src/order.ts?raw'
import pipelineMain from '../../../../../examples/07-dag-pipeline/src/main.ts?raw'
import pipelineSource from '../../../../../examples/07-dag-pipeline/src/pipeline.ts?raw'
import mermaidSource from '../../../../../examples/09-mermaid/src/checkout.ts?raw'
import mermaidMain from '../../../../../examples/09-mermaid/src/main.ts?raw'
import backendOrderMain from '../../../../../examples/11-order-workflow/src/main.ts?raw'
import backendOrderSource from '../../../../../examples/11-order-workflow/src/order-workflow.ts?raw'

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

/** Keep the landing example small enough to understand without scrolling. */
export const landingSample: PlaygroundSample = {
  id: 'landing',
  title: 'Hello wizard',
  entry: 'main.ts',
  files: [
    { name: 'hello.ts', content: helloSource },
    { name: 'main.ts', content: helloMain },
  ],
}

const example = (
  id: string,
  title: string,
  sourceFile: string,
  source: string,
  main: string,
): PlaygroundSample => ({
  id,
  title,
  entry: 'main.ts',
  files: [
    { name: sourceFile, content: source },
    { name: 'main.ts', content: main },
  ],
})

/** The runnable examples, verbatim (08 is a React app and lives on its own page). */
const exampleSamples: readonly PlaygroundSample[] = [
  example(
    '11-order-workflow',
    '11 - backend order workflow',
    'order-workflow.ts',
    backendOrderSource,
    backendOrderMain,
  ),
  example('01-happy-path', '01 - hello wizard', 'hello.ts', helloSource, helloMain),
  example(
    '02-recoverable-failure',
    '02 - recoverable failure',
    'sync-invoice.ts',
    syncInvoiceSource,
    syncInvoiceMain,
  ),
  example(
    '03-non-recoverable-compensation',
    '03 - compensation',
    'book-trip.ts',
    bookTripSource,
    bookTripMain,
  ),
  example(
    '04-resume-from-snapshot',
    '04 - resume from snapshot',
    'approval.ts',
    approvalSource,
    approvalMain,
  ),
  example(
    '05-external-events',
    '05 - external events',
    'checkout.ts',
    checkoutSource,
    checkoutMain,
  ),
  example('06-nested-wizard', '06 - nested wizard', 'order.ts', orderSource, orderMain),
  example(
    '07-dag-pipeline',
    '07 - parallel work and joins',
    'pipeline.ts',
    pipelineSource,
    pipelineMain,
  ),
  example('09-mermaid', '09 - mermaid', 'checkout.ts', mermaidSource, mermaidMain),
]

export const allSamples: readonly PlaygroundSample[] = [landingSample, ...exampleSamples]
