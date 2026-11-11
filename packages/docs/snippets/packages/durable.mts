import { createDurableHost, createMemoryDurableStore } from '@openwizard/durable'
import { helloFlow } from '../../../../examples/01-happy-path/src/hello-flow'

const host = createDurableHost(helloFlow, {
  store: createMemoryDurableStore(),
  ownerId: 'worker-a',
})
const opened = await host.create('hello-1', { name: 'Ada' })
if (!opened.ok) throw new Error(opened.code)
await opened.host.dispatch({ type: 'start' }, { commandId: 'start-hello-1' })
const result = await opened.host.run.awaitResult()
if (result.status !== 'done') throw new Error('run did not finish')
await host.dispose()
