import { createDurableHost, createMemoryDurableStore } from '@openwizard/durable'
import { approval } from '../learn/wait' // the wizard from Wait for events and time

export async function serveApproval() {
  // One host per process. Every process shares the same store.
  const host = createDurableHost(approval, { store: createMemoryDurableStore() })
  const key = 'approvals/42'

  const opened = await host.create(key, {})
  if (!opened.ok) return opened // for example { ok: false, code: 'LEASE_BUSY', retryAt }

  // The id makes a repeated request replay the stored result.
  const started = await host.dispatch(key, { type: 'start' }, { commandId: 'request-1' })
  const repeated = await host.dispatch(key, { type: 'start' }, { commandId: 'request-1' })
  const sent = await host.send(key, 'approved', { by: 'Grace' }, { eventId: 'delivery-9' })

  // { status: 'done', output: 'Approved by Grace' }
  const result = await opened.host.run.awaitResult()
  await host.dispose()
  return { ok: true as const, started, repeated, sent, result }
}
