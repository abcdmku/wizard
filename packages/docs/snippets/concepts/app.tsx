import type { Mirror } from '@openwizard/core'
import { bindReact } from '@openwizard/react'
import type { publicOrder } from './public-order'

const orderUI = bindReact<typeof publicOrder>()

export function App({ mirror }: { mirror: Mirror<typeof publicOrder> }) {
  return (
    <orderUI.Provider source={mirror} fallback={<p>Connecting...</p>}>
      <Order />
    </orderUI.Provider>
  )
}

function Order() {
  const state = orderUI.useSnapshot()
  const actions = orderUI.useActions()
  return (
    <button type="button" onClick={() => void actions.start()}>
      {state.status}
    </button>
  )
}
