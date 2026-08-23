import type { FlowRun } from '@openwizard/core'
import { bindReact } from '@openwizard/react'
import type { helloFlow } from '../../../../examples/01-happy-path/src/hello-flow'

const hello = bindReact<typeof helloFlow>()

function Status() {
  const state = hello.useSnapshot()
  return <p>Run status: {state.status}</p>
}

export function HelloStatus({ run }: { run: FlowRun<typeof helloFlow> }) {
  return (
    <hello.Provider source={run}>
      <Status />
    </hello.Provider>
  )
}
