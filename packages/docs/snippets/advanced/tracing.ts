import { instrumentRun } from '@openwizard/opentelemetry'
import { dashboard } from '../learn/needs' // the wizard from Pass data between steps

export async function tracedDashboard() {
  const run = dashboard.create({ userId: '7' })
  const telemetry = instrumentRun(run) // attach before start() to see the whole run

  await run.start()
  const result = await run.awaitResult()

  telemetry.stop() // ends open spans
  run.dispose()
  return result
}
