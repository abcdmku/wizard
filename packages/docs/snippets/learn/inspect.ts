import { formatTrace, inspect, toMarkdown } from '@openwizard/core/inspect'
import { approval } from './wait' // the wizard from Wait for events and time

/** One page: a diagram, a table of every step, the events and the warnings. */
export const page = toMarkdown(inspect(approval))

export async function debugApproval() {
  const run = approval.create({})
  await run.start()

  const why = run.explain('close').reasons // ['not-activated', 'deps-unmet:decision']
  const waits = run.waitingFor() // [{ kind: 'event', step: 'decision', events: ['approved'], ... }]
  await run.send('approved', { by: 'Grace' })
  const trace = formatTrace(run.log()) // one line per event

  run.dispose()
  return { why, waits, trace }
}
