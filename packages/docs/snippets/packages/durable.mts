import { createDurableRun, createMemoryDurableStore } from '@openwizard/durable'
import { helloFlow } from '../../../../examples/01-happy-path/src/hello-flow'

const opened = await createDurableRun(helloFlow, {
  context: { name: 'Ada' },
  store: createMemoryDurableStore(),
  key: 'hello-1',
  ownerId: 'worker-a',
})

if (!opened.ok) throw new Error(opened.code)

await opened.host.run.start()
const result = await opened.host.run.awaitResult()
if (result.status !== 'done') throw new Error('run did not finish')
await opened.host.dispose()
