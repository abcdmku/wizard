import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { inspect } from '../../src/inspect/graph'
import { toMermaid } from '../../src/inspect/mermaid'

describe('toMermaid', () => {
  const fulfilment = defineFlow({ name: 'fulfilment', context: z.object({ orderId: z.string() }) })
  const fulfilmentFlow = fulfilment.steps({
    label: fulfilment.task(async () => ({ trackingId: 'x' }), { next: 'done' }),
    done: fulfilment.final(),
  })
  const checkout = defineFlow({
    name: 'checkout',
    context: z.object({ cartId: z.string(), paymentId: z.string().optional() }),
    events: { 'payment.captured': z.object({ paymentId: z.string() }) },
  })
  const checkoutFlow = checkout.steps(
    {
      shipping: checkout.view({ input: z.object({ address: z.string() }), next: 'reserve' }),
      reserve: checkout.task(async () => ({ reservationId: 'r' }), {
        next: ['awaitPayment', 'audit'],
      }),
      audit: checkout.task(async () => 1, { next: 'route' }),
      awaitPayment: checkout.wait({
        on: {
          'payment.captured': ({ payload, update }) => update({ paymentId: payload.paymentId }),
        },
        timeout: { after: '15m', next: 'expired' },
        next: 'route',
      }),
      route: checkout.decision({
        dependsOn: ['reserve', 'audit'],
        next: ({ context }) => (context.paymentId ? 'fulfil' : 'declined'),
      }),
      fulfil: checkout.flow(fulfilmentFlow, {
        context: ({ context }) => ({ orderId: context.cartId }),
        next: 'receipt',
      }),
      receipt: checkout.final(),
      declined: checkout.final(),
      expired: checkout.final(),
    },
    { start: 'shipping' },
  )

  it('renders a flowchart TD: id (kind) nodes by shape, start circle, next / labelled dependsOn / dashed timeout edges, dynamic next → ?, child subgraph', () => {
    expect(toMermaid(inspect(checkoutFlow))).toBe(
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
    const weird = defineFlow({ name: 'weird', context: boundary.trusted<{}>() })
    const weirdFlow = weird.steps(
      {
        'a-b': weird.task(async () => 1, { next: ['end', 'a_b'] }),
        a_b: weird.task(async () => 1, { timeout: '2500ms', next: 'end' }),
        '1st': weird.task(async () => 1, { dependsOn: { any: ['a-b', 'a_b'] }, next: 'say "hi"' }),
        'say "hi"': weird.view({ next: 'end' }),
        end: weird.final(),
      },
      { start: ['a-b', '1st'] },
    )
    const text = toMermaid(inspect(weirdFlow))
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
    expect(toMermaid(inspect(weirdFlow))).toBe(text)
  })

  it('entity-escapes label text: line breaks become spaces, & < > " # ; [ ] become Mermaid entities (node labels and subgraph titles)', () => {
    const inner = defineFlow({ name: 'inner', context: boundary.trusted<{}>() })
    const child = inner.steps({ 'a & b': inner.final() })
    const hostile = defineFlow({ name: 'hostile', context: boundary.trusted<{}>() })
    const hostileFlow = hostile.steps(
      {
        'line\r\nbreak\n<b>': hostile.view({ next: 'sub[0]; #1' }),
        'sub[0]; #1': hostile.flow(child, { context: () => ({}), next: 'end' }),
        end: hostile.final(),
      },
      { start: 'line\r\nbreak\n<b>' },
    )
    const text = toMermaid(inspect(hostileFlow))
    const labels = [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '')
    // Once the entities are stripped, no line break / & / < / > / # / ; / [ / ] survives in a label.
    for (const label of labels) {
      expect(label.replace(/#[a-z0-9]+;/g, '')).not.toMatch(/[\r\n&<>#;[\]]/)
    }
    expect(text).toContain('["line break #lt;b#gt; (view)"]')
    expect(text).toContain('[/"sub#91;0#93;#59; #35;1 (flow)"/]')
    expect(text).toContain('subgraph sub_0____1___flow ["sub#91;0#93;#59; #35;1"]')
    expect(text).toContain('(("a #amp; b (final)"))')
    // Statements stay one per line: a label never introduces a new line.
    expect(text.split('\n').every((line) => /^ {2,}\S/.test(line) || line === 'flowchart TD')).toBe(
      true,
    )
  })
})
