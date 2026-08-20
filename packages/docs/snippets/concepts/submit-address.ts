import type { FlowRun } from '@openwizard/core'
import type { orderFlow } from './order-flow'

export async function submitAddress(run: FlowRun<typeof orderFlow>) {
  await run.start()
  await run.setInput('address', { city: '' })

  const moved = await run.next()
  if (!moved.ok && moved.reason === 'validation') return moved.issues

  await run.setInput('address', { city: 'Chicago' })
  await run.next()
  return run.awaitResult()
}
