import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { inspect } from '../../src/inspect'
import { defineWizard } from '../../src/wizard/define-wizard'

describe('wizard prose', () => {
  it('copies the description and meta of the wizard and its steps to the manifest', () => {
    const wizard = defineWizard(
      {
        name: 'invoice',
        description: 'Sends one invoice.',
        meta: { owner: 'billing', tier: 2 },
        context: z.object({ id: z.string() }),
      },
      ({ step, steps }) =>
        steps({
          send: step({
            label: 'Send',
            description: 'Emails the invoice to the customer.',
            meta: { service: 'mailer' },
            run: () => 'sent',
          }),
        }),
    )

    const graph = inspect(wizard)

    expect(graph.description).toBe('Sends one invoice.')
    expect(graph.meta).toEqual({ owner: 'billing', tier: 2 })
    expect(graph.nodes[0]).toMatchObject({
      label: 'Send',
      description: 'Emails the invoice to the customer.',
      meta: { service: 'mailer' },
    })
  })
})
