import type { FlowRun } from '@openwizard/core'
import { bindReact } from '@openwizard/react'
import type { orderFlow } from './order-flow'

const orderUI = bindReact<typeof orderFlow>()

function Address() {
  const { input, issues, setInput, next } = orderUI.useStep('address')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void next()
      }}
    >
      <input
        value={input?.street ?? ''}
        onChange={(event) => void setInput({ street: event.target.value })}
      />
      {issues?.map((issue) => (
        <p key={issue.message}>{issue.message}</p>
      ))}
    </form>
  )
}

export function OrderApp({ run }: { run: FlowRun<typeof orderFlow> }) {
  return (
    <orderUI.Provider source={run}>
      <Address />
    </orderUI.Provider>
  )
}
