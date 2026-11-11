import { signupFlow } from './form'

const run = signupFlow.create({})

await run.start()
await run.setInput('contact', { email: 'ada@example.com' })

const moved = await run.next()
if (!moved.ok) throw new Error(moved.message) // reason 'validation' also carries `issues`

const result = await run.awaitResult()
if (result.status !== 'done') throw new Error('signup did not finish')
run.dispose()
