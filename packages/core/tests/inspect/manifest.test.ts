import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { RUN_ADAPTER } from '../../src/authoring/run-adapter'
import { inspect } from '../../src/inspect'
import { defineWizard } from '../../src/wizard/define-wizard'

describe('inspect manifest', () => {
  const order = (variant: 'base' | 'reordered with prose' | 'guarded' | 'one more step') => {
    const options = {
      name: 'order',
      context: z.object({
        id: variant === 'reordered with prose' ? z.string().describe('order id') : z.string(),
      }),
      events: { paid: z.object({ amount: z.number() }) },
    }
    switch (variant) {
      case 'base':
        return defineWizard(options, ({ step, steps }) =>
          steps(
            {
              charge: step({ run: async () => 1, next: 'wait' }),
              wait: step({ waitFor: { paid: () => {} }, next: 'ship' }),
              ship: step({ next: null }),
            },
            { start: 'charge' },
          ),
        )
      case 'reordered with prose':
        return defineWizard(options, ({ step, steps }) =>
          steps(
            {
              ship: step({ next: null }),
              wait: step({ waitFor: { paid: () => {} }, next: 'ship' }),
              charge: step({ run: async () => 1, next: 'wait', label: 'Charge' }),
            },
            { start: 'charge' },
          ),
        )
      case 'guarded':
        return defineWizard(options, ({ step, steps }) =>
          steps(
            {
              charge: step({ run: async () => 1, next: 'wait', when: () => true }),
              wait: step({ waitFor: { paid: () => {} }, next: 'ship' }),
              ship: step({ next: null }),
            },
            { start: 'charge' },
          ),
        )
      case 'one more step':
        return defineWizard(options, ({ step, steps }) =>
          steps(
            {
              charge: step({ run: async () => 1, next: 'audit' }),
              audit: step({ run: async () => 2, next: 'wait' }),
              wait: step({ waitFor: { paid: () => {} }, next: 'ship' }),
              ship: step({ next: null }),
            },
            { start: 'charge' },
          ),
        )
    }
  }

  it('fingerprints structure and schemas only: order, prose and hooks keep it, a new step changes it', () => {
    const base = inspect(order('base')).fingerprint
    expect(base).toMatch(/^[0-9a-f]{16}$/)
    expect(inspect(order('reordered with prose')).fingerprint).toBe(base)
    // Not a behaviour hash: a new `when` guard changes what runs, not the structure.
    expect(inspect(order('guarded')).fingerprint).toBe(base)
    expect(inspect(order('one more step')).fingerprint).not.toBe(base)
  })

  it('carries draft 2020-12 JSON Schemas of the context and event payloads from Standard JSON Schema vendors', () => {
    expect(inspect(order('reordered with prose')).schemas).toEqual({
      context: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { id: { type: 'string', description: 'order id' } },
        required: ['id'],
      },
      events: {
        paid: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: { amount: { type: 'number' } },
          required: ['amount'],
        },
      },
    })
  })

  it('lists declared events without a schema when the boundary has no JSON Schema converter', () => {
    const wizard = defineWizard(
      {
        name: 'trusted',
        context: boundary.trusted<{ n: number }>(),
        events: { go: boundary.trusted<{ at: string }>() },
      },
      ({ step, steps }) => steps({ only: step({ next: null }) }),
    )
    const graph = inspect(wizard)
    expect(graph.schemas).toEqual({ events: { go: undefined } })
  })

  it('reports retry facts of runnable steps: their own policy, else the flow default', () => {
    const wizard = defineWizard(
      {
        name: 'retrying',
        context: boundary.trusted<{}>(),
        retry: { attempts: 2 },
      },
      ({ step, view, steps }) =>
        steps({
          own: step({
            run: async () => 1,
            retry: {
              attempts: 5,
              backoff: 'exponential',
              baseMs: 100,
              factor: 3,
              maxBackoffMs: 2000,
            },
            next: 'inherited',
          }),
          inherited: step({ run: async () => 1, next: 'form' }),
          form: view({ input: boundary.trusted<{}>() }),
        }),
    )
    expect(inspect(wizard).nodes.map((node) => [node.id, node.retry])).toEqual([
      ['own', { attempts: 5, backoff: 'exponential', baseMs: 100, factor: 3, maxBackoffMs: 2000 }],
      ['inherited', { attempts: 2 }],
      ['form', undefined],
    ])
  })

  it('uses the authored output boundary over an adapter default when describing the run output', () => {
    const adapter = { [RUN_ADAPTER]: { run: () => 1, output: z.number() } }
    const wizard = defineWizard(
      { name: 'adapter-output', context: boundary.trusted<{}>() },
      ({ step, steps }) => steps({ only: step({ run: adapter, output: z.number().min(0) }) }),
    )
    expect(inspect(wizard).nodes[0]?.output).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'number',
      minimum: 0,
    })
  })

  it('warns EXCLUSIVE_JOIN when an AND-join waits for both outcomes of an event timeout', () => {
    const wizard = defineWizard(
      {
        name: 'join',
        context: boundary.trusted<{}>(),
        events: { paid: boundary.trusted() },
      },
      ({ step, steps }) =>
        steps({
          wait: step({
            waitFor: { paid: () => {} },
            timeout: { after: '1h', next: 'expired' },
            next: 'paid',
          }),
          paid: step({ run: async () => 1, next: 'join' }),
          expired: step({ run: async () => 1, next: 'join' }),
          join: step({ run: async () => 1, dependsOn: ['paid', 'expired'] }),
        }),
    )
    expect(inspect(wizard).warnings).toEqual([
      {
        code: 'EXCLUSIVE_JOIN',
        message:
          "step 'join' depends on all of 'paid', 'expired', which are alternative branches of 'wait' (only one runs); use dependsOn: { any: [...] } or join after the branches merge",
        step: 'join',
        path: [],
      },
    ])
  })
})
