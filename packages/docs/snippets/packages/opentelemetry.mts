import { instrumentRun } from '@openwizard/opentelemetry'
import { helloFlow } from '../../../../examples/01-happy-path/src/hello-flow'

const run = helloFlow.create({ name: 'Ada' })
const telemetry = instrumentRun(run)

await run.start()
await run.awaitResult()
telemetry.stop()
run.dispose()
