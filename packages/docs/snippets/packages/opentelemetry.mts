import { instrumentRun } from '@openwizard/opentelemetry'
import { hello } from '../../../../examples/01-happy-path/src/hello'

const run = hello.create({ name: 'Ada' })
const telemetry = instrumentRun(run)

await run.start()
await run.awaitResult()
telemetry.stop()
run.dispose()
