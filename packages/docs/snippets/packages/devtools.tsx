import type { FlowRun } from '@openwizard/core'
import { Devtools } from '@openwizard/devtools'
import '@openwizard/devtools/style.css'
import type { helloFlow } from '../../../../examples/01-happy-path/src/hello-flow'

export function WorkflowTools({ run }: { run: FlowRun<typeof helloFlow> }) {
  return <Devtools source={run} />
}
