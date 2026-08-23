import { createRun } from '@openwizard/core'
import { helloFlow } from './hello-flow'

const run = createRun(helloFlow, {
  context: { name: 'Ada' },
})

await run.start()

const result = await run.awaitResult()
if (result.status === 'done') console.log(result.output)

run.dispose()
