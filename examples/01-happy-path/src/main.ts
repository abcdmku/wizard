import { hello } from './hello'

// run() creates, starts, waits for an outcome, and disposes the run.
const result = await hello.run({ name: 'Ada' })
if (result.status === 'done') console.log(result.output)
