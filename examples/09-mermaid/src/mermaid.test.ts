import { inspect, toMermaid } from '@openwizard/core'
import { describe, expect, it } from 'vitest'
import { checkout } from './checkout'

describe('09 mermaid: toMermaid(inspect(flow))', () => {
  it('renders the checkout graph as a flowchart TD (nodes by kind, next / dependsOn / timeout edges, ? for a dynamic next, the child as a subgraph)', () => {
    const graph = inspect(checkout)
    expect(graph.warnings).toEqual([])
    expect(toMermaid(graph)).toBe(
      [
        'flowchart TD',
        '  shipping["shipping (view)"]',
        '  reserve[["reserve (task)"]]',
        '  audit[["audit (task)"]]',
        '  awaitPayment(["awaitPayment (wait)"])',
        '  route{"route (decision)"}',
        '  fulfil[/"fulfil (flow)"/]',
        '  receipt(("receipt (final)"))',
        '  declined(("declined (final)"))',
        '  expired(("expired (final)"))',
        '  _start((" "))',
        '  _start --> shipping',
        '  shipping --> reserve',
        '  reserve --> awaitPayment',
        '  reserve --> audit',
        '  audit --> route',
        '  awaitPayment --> route',
        '  awaitPayment -.->|timeout 15m| expired',
        '  awaitPayment -->|dependsOn| route',
        '  audit -->|dependsOn| route',
        '  fulfil --> receipt',
        '  route -.-> route___next{"?"}',
        '  subgraph fulfil___flow ["fulfil"]',
        '    fulfil__label[["label (task)"]]',
        '    fulfil__done(("done (final)"))',
        '    fulfil___start((" "))',
        '    fulfil___start --> fulfil__label',
        '    fulfil__label --> fulfil__done',
        '  end',
        '  fulfil -.->|child| fulfil___flow',
      ].join('\n'),
    )
    // Same graph in, same text out — safe to commit next to the flow (docs, PR diffs).
    expect(toMermaid(inspect(checkout))).toBe(toMermaid(graph))
  })
})
