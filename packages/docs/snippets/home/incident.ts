import { boundary, defineWizard } from '@openwizard/core'
import { z } from 'zod'

export interface IncidentDeps {
  pager: { page(who: string, service: string): Promise<{ pageId: string }> }
  wiki: { createPostmortem(service: string, owner: string, fix: string): Promise<{ url: string }> }
}

export const incident = defineWizard(
  {
    name: 'incident',
    description: 'Pages on-call, escalates after five minutes of silence and files a postmortem.',
    context: z.object({ service: z.string() }),
    deps: boundary.trusted<IncidentDeps>(),
    events: {
      'incident.acked': z.object({ by: z.string() }),
      'incident.resolved': z.object({ fix: z.string() }),
    },
  },
  ({ step, steps }) => {
    const page = step({
      description: 'Pages the engineer on call.',
      run: ({ context, deps }) => deps.pager.page('on-call', context.service),
      next: 'ack',
    })
    const ack = step({
      description: 'Waits five minutes for someone to take the page.',
      waitFor: { 'incident.acked': ({ payload }) => ({ done: payload.by }) },
      timeout: { after: '5m', next: 'escalate' },
    })
    const escalate = step({
      description: 'Nobody answered, so this pages the engineering manager.',
      run: async ({ context, deps }) => {
        await deps.pager.page('manager', context.service)
        return 'manager'
      },
    })
    const resolved = step({
      description: 'Waits for the monitoring system to report the fix.',
      needs: { owner: { any: [ack, escalate] } },
      waitFor: { 'incident.resolved': ({ payload }) => ({ done: payload.fix }) },
    })
    const postmortem = step({
      description: 'Files the postmortem under whoever owned the incident.',
      needs: { resolved, owner: { any: [ack, escalate] } },
      run: ({ context, deps, needs }) =>
        deps.wiki.createPostmortem(context.service, needs.owner, needs.resolved),
    })
    return steps({ page, ack, escalate, resolved, postmortem })
  },
)
