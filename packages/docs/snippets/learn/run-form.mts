import { createRun } from '@openwizard/core'
import { signupFlow } from './form'

const run = createRun(signupFlow, { context: {} })

await run.start()
await run.setInput('contact', { email: 'ada@example.com' })

const moved = await run.next()
if (!moved.ok) throw new Error(moved.message)

const result = await run.awaitResult()
if (result.status !== 'done') throw new Error('signup did not finish')
run.dispose()
