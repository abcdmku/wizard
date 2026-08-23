import { createRun } from '@openwizard/core'
import { instrumentRun } from '@openwizard/opentelemetry'
import { helloFlow } from '../../../../examples/01-happy-path/src/hello-flow'

const run = createRun(helloFlow, { context: { name: 'Ada' } })
const telemetry = instrumentRun(run)

await run.start()
await run.awaitResult()

telemetry.stop()
run.dispose()
