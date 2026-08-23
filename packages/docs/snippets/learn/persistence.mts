import { createMemoryStore, createRun, resumeRun } from '@openwizard/core'
import { signupFlow } from './form'

const store = createMemoryStore()

const first = createRun(signupFlow, {
  context: {},
  instanceId: 'signup-1',
  store,
})
await first.start()
await first.setInput('contact', { email: 'ada@example.com' })
await first.save()
first.dispose()

const snapshot = await store.get('signup-1')
const second = resumeRun(signupFlow, snapshot, { store })

await second.next()
const result = await second.awaitResult()
if (result.status !== 'done') throw new Error('signup did not finish')
second.dispose()
