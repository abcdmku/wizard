import type { ProjectionOutput } from '@openwizard/core'
import { createMirror, type Transport } from '@openwizard/core/mirror'
import { bindReact, useRun } from '@openwizard/react'
import type { checkoutClient } from './projection'

const ui = bindReact<typeof checkoutClient>()

function Payment() {
  const total = ui.useSelector((state) => state.context.total)
  const payment = ui.useStep('payment')
  const pay = async () => {
    await payment.setInput({ cardToken: 'tok_demo' })
    await payment.next()
  }
  return (
    <button type="button" onClick={() => void pay()}>
      Pay {total}
    </button>
  )
}

type Props = { transport: Transport<ProjectionOutput<typeof checkoutClient>> }

export function Checkout({ transport }: Props) {
  const mirror = useRun(() => createMirror<typeof checkoutClient>({ transport }), [transport])
  return (
    <ui.Provider source={mirror} fallback={<p>Connecting</p>}>
      <Payment />
    </ui.Provider>
  )
}
