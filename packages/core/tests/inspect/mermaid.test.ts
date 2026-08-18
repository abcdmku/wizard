import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { inspect } from '../../src/inspect/graph'
import { toMermaid } from '../../src/inspect/mermaid'

describe('toMermaid', () => {
  const f = defineFlow({ name: 'fulfilment', context: z.object({ orderId: z.string() }) })
  const fulfilment = f.steps({
    label: f.task(async () => ({ trackingId: 'x' }), { next: 'done' }),
    done: f.final(),
  })
  const c = defineFlow({
    name: 'checkout',
    context: z.object({ cartId: z.string(), paymentId: z.string().optional() }),
    events: { 'payment.captured': z.object({ paymentId: z.string() }) },
  })
  const checkout = c.steps(
    {
      shipping: c.view({ input: z.object({ address: z.string() }), next: 'reserve' }),
      reserve: c.task(async () => ({ reservationId: 'r' }), { next: ['awaitPayment', 'audit'] }),
      audit: c.task(async () => 1, { next: 'route' }),
      awaitPayment: c.wait({
        on: {
          'payment.captured': ({ payload, update }) => update({ paymentId: payload.paymentId }),
        },
        timeout: { after: '15m', next: 'expired' },
        next: 'route',
      }),
      route: c.decision({
        dependsOn: ['reserve', 'audit'],
        next: ({ context }) => (context.paymentId ? 'fulfil' : 'declined'),
      }),
      fulfil: c.flow(fulfilment, {
        context: ({ context }) => ({ orderId: context.cartId }),
        next: 'receipt',
      }),
      receipt: c.final(),
      declined: c.final(),
      expired: c.final(),
    },
    { start: 'shipping' },
  )

  it('renders a flowchart TD: id (kind) nodes by shape, start circle, next / labelled dependsOn / dashed timeout edges, dynamic next → ?, child subgraph', () => {
    expect(toMermaid(inspect(checkout))).toBe(
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
        '  reserve -->|dependsOn| route',
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
  })

  it('labels an OR-join `dependsOn (any)`, sanitises ids (reserved words, symbols, digits, quotes) and keeps them unique', () => {
    const s = defineFlow({ name: 'weird', context: boundary.trusted<{}>() })
    const weird = s.steps(
      {
        'a-b': s.task(async () => 1, { next: ['end', 'a_b'] }),
        a_b: s.task(async () => 1, { timeout: '2500ms', next: 'end' }),
        '1st': s.task(async () => 1, { dependsOn: { any: ['a-b', 'a_b'] }, next: 'say "hi"' }),
        'say "hi"': s.view({ next: 'end' }),
        end: s.final(),
      },
      { start: ['a-b', '1st'] },
    )
    const text = toMermaid(inspect(weird))
    expect(text).toContain('  a_b[["a-b (task)"]]')
    expect(text).toContain('  a_b_2[["a_b (task)"]]')
    expect(text).toContain('  n_1st[["1st (task)"]]')
    expect(text).toContain('  say__hi_["say #quot;hi#quot; (view)"]')
    expect(text).toContain('  end_(("end (final)"))')
    expect(text).toContain('  a_b -->|dependsOn (any)| n_1st')
    expect(text).toContain('  a_b_2 -->|dependsOn (any)| n_1st')
    expect(text).toContain('  _start --> a_b\n')
    expect(text).toContain('  _start --> n_1st')
    // A task timeout is not an edge (no `timeout.next`), so no dashed edge appears for `a_b`.
    expect(text).not.toContain('a_b_2 -.->')
    // The output is stable.
    expect(toMermaid(inspect(weird))).toBe(text)
  })
})
