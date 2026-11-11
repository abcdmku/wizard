import { helloFlow } from './hello-flow'

// run() creates, starts, waits for an outcome, and disposes the run.
const result = await helloFlow.run({ name: 'Ada' })
if (result.status === 'done') console.log(result.output)
