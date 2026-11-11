import { inspect, toMermaid } from '@openwizard/core/inspect'
import { describe, expect, it } from 'vitest'
import { checkout } from './checkout'

describe('09 mermaid: toMermaid(inspect(wizard))', () => {
  it('renders titled step shapes, start, join labels, the timeout, the event, a dynamic target and the child subgraph', () => {
    const graph = inspect(checkout)
    expect(graph.warnings.map((warning) => warning.code)).toEqual(['MULTIPLE_SINKS'])
    expect(toMermaid(graph)).toBe(
      [
        '---',
        'title: "checkout"',
        '---',
        'flowchart TD',
        '  shipping["shipping"]',
        '  reserve[["reserve"]]',
        '  audit[["audit"]]',
        '  awaitPayment[["awaitPayment"]]',
        '  route[["route"]]',
        '  fulfil[/"fulfil"/]',
        '  receipt[["receipt"]]',
        '  declined[["declined"]]',
        '  expired[["expired"]]',
        '  _start((" "))',
        '  _start --> shipping',
        '  shipping --> reserve',
        '  reserve --> awaitPayment',
        '  reserve --> audit',
        '  route -.->|"route"| fulfil',
        '  route -.->|"route"| declined',
        '  audit -->|"needs: audit"| route',
        '  awaitPayment -->|"needs: payment (optional)"| route',
        '  fulfil --> receipt',
        '  awaitPayment -.->|"timeout 15m"| expired',
        '  _event__payment_captured>"payment.captured"] -.-> awaitPayment',
        '  subgraph fulfil___child ["fulfilment"]',
        '    fulfil__label[["label"]]',
        '    fulfil__done[["done"]]',
        '    fulfil___start((" "))',
        '    fulfil___start --> fulfil__label',
        '    fulfil__label -->|"needs: label"| fulfil__done',
        '  end',
        '  fulfil -.->|"child"| fulfil___child',
      ].join('\n'),
    )
    // Same graph in, same text out, so it is safe to commit next to the wizard (docs, PR diffs).
    expect(toMermaid(inspect(checkout))).toBe(toMermaid(graph))
  })
})
