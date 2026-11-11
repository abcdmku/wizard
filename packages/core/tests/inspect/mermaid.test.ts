import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { inspect, toMermaid } from '../../src/inspect'
import { defineWizard } from '../../src/wizard/define-wizard'

// Every expected text below parses with the real Mermaid parser (`mermaid.parse`, flowchart-v2).
describe('toMermaid', () => {
  const fulfilment = defineWizard(
    { name: 'fulfilment', context: z.object({ orderId: z.string() }) },
    ({ step, steps }) =>
      steps({
        label: step({ run: async () => ({ trackingId: 'x' }), next: 'done' }),
        done: step({ next: null }),
      }),
  )
  const checkout = defineWizard(
    {
      name: 'checkout',
      context: z.object({ cartId: z.string(), paymentId: z.string().optional() }),
      events: { 'payment.captured': z.object({ paymentId: z.string() }) },
    },
    ({ step, view, flow, steps }) => {
      const reserve = step({
        run: async () => ({ reservationId: 'r' }),
        next: ['awaitPayment', 'audit'],
        retry: { retries: 3 },
        compensate: () => {},
      })
      const audit = step({ run: async () => 1, next: 'route', when: () => true, timeout: '30s' })
      return steps(
        {
          shipping: view({
            label: 'Shipping address',
            input: z.object({ address: z.string() }),
            next: 'reserve',
          }),
          reserve,
          audit,
          awaitPayment: step({
            waitFor: {
              'payment.captured': ({ payload, update }) => update({ paymentId: payload.paymentId }),
            },
            timeout: { after: '15m', next: 'expired' },
            next: 'route',
          }),
          route: step({
            needs: { reserve, audit: { optional: audit } },
            next: ({ context }) => (context.paymentId ? 'fulfil' : 'declined'),
            targets: ['fulfil', 'declined'],
          }),
          fulfil: flow(fulfilment, {
            context: ({ context }) => ({ orderId: context.cartId }),
            next: 'receipt',
          }),
          receipt: step({ next: null }),
          declined: step({ next: null }),
          expired: step({ next: null }),
        },
        { start: 'shipping' },
      )
    },
  )

  it('draws a titled flowchart with join labels, timeouts, events, declared route targets and a child flow', () => {
    expect(toMermaid(inspect(checkout))).toBe(
      [
        '---',
        'title: "checkout"',
        '---',
        'flowchart TD',
        '  shipping["Shipping address"]',
        '  reserve[["reserve<br/>3 retries · compensable"]]',
        '  audit[["audit<br/>may skip · timeout 30s"]]',
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
        '  audit -->|"needs: audit (optional)"| route',
        '  awaitPayment --> route',
        '  route -.->|"route"| fulfil',
        '  route -.->|"route"| declined',
        '  reserve -->|"needs: reserve"| route',
        '  fulfil --> receipt',
        '  awaitPayment -.->|"timeout 15m"| expired',
        '  _event__payment_captured>"payment.captured"] -.-> awaitPayment',
        '  subgraph fulfil___flow ["fulfilment"]',
        '    fulfil__label[["label"]]',
        '    fulfil__done[["done"]]',
        '    fulfil___start((" "))',
        '    fulfil___start --> fulfil__label',
        '    fulfil__label --> fulfil__done',
        '  end',
        '  fulfil -.->|"child"| fulfil___flow',
      ].join('\n'),
    )
  })

  it('quotes the `needs: first (any)` label (unquoted parentheses break the Mermaid parser) and keeps sanitised ids unique', () => {
    const weird = defineWizard(
      { name: 'weird', context: boundary.trusted<{}>() },
      ({ step, view, steps }) => {
        const dashed = step({ run: async () => 1, next: ['end', 'a_b'] })
        const underscored = step({ run: async () => 1, timeout: '2500ms', next: 'end' })
        return steps(
          {
            'a-b': dashed,
            a_b: underscored,
            '1st': step({
              run: async () => 1,
              needs: { first: { any: [dashed, underscored] } },
              next: 'say "hi"',
            }),
            'say "hi"': view({ input: boundary.trusted<{}>(), next: 'end' }),
            end: step({ next: null }),
          },
          { start: 'a-b' },
        )
      },
    )
    expect(toMermaid(inspect(weird))).toBe(
      [
        '---',
        'title: "weird"',
        '---',
        'flowchart TD',
        '  a_b[["a-b"]]',
        '  a_b_2[["a_b<br/>timeout 2500ms"]]',
        '  n_1st[["1st"]]',
        '  say__hi_["say #quot;hi#quot;"]',
        '  end_[["end"]]',
        '  _start((" "))',
        '  _start --> a_b',
        '  a_b --> end_',
        '  a_b --> a_b_2',
        '  a_b_2 --> end_',
        '  n_1st --> say__hi_',
        '  a_b -->|"needs: first (any)"| n_1st',
        '  a_b_2 -->|"needs: first (any)"| n_1st',
        '  say__hi_ --> end_',
      ].join('\n'),
    )
  })

  it('entity-escapes labels and subgraph titles: line breaks become spaces, & < > # ; [ ] become entities', () => {
    const child = defineWizard(
      { name: 'inner', context: boundary.trusted<{}>() },
      ({ step, steps }) => steps({ 'a & b': step({ next: null }) }),
    )
    const hostile = defineWizard(
      { name: 'ho"stile', context: boundary.trusted<{}>() },
      ({ step, view, flow, steps }) =>
        steps(
          {
            'line\r\nbreak\n<b>': view({ input: boundary.trusted<{}>(), next: 'sub[0]; #1' }),
            'sub[0]; #1': flow(child, { context: () => ({}), next: 'end' }),
            end: step({ next: null }),
          },
          { start: 'line\r\nbreak\n<b>' },
        ),
    )
    expect(toMermaid(inspect(hostile))).toBe(
      [
        '---',
        'title: "ho\\"stile"',
        '---',
        'flowchart TD',
        '  line__break__b_["line break #lt;b#gt;"]',
        '  sub_0____1[/"sub#91;0#93;#59; #35;1"/]',
        '  end_[["end"]]',
        '  _start((" "))',
        '  _start --> line__break__b_',
        '  line__break__b_ --> sub_0____1',
        '  sub_0____1 --> end_',
        '  subgraph sub_0____1___flow ["inner"]',
        '    sub_0____1__a___b[["a #amp; b"]]',
        '    sub_0____1___start((" "))',
        '    sub_0____1___start --> sub_0____1__a___b',
        '  end',
        '  sub_0____1 -.->|"child"| sub_0____1___flow',
      ].join('\n'),
    )
  })
})
