/**
 * Runnable walk-through: `pnpm --filter example-06-nested-flow start`.
 * The parent pays, then hands over to the child fulfilment flow; every child event is printed
 * with its path.
 */
import { createWizard } from '@openwizard/core'
import { type Deps, order } from './order'

const deps: Deps = {
  payments: { charge: (orderId) => ({ chargeId: `ch_${orderId}` }) },
  carrier: { ship: async (orderId, warehouse) => ({ tracking: `TRK-${warehouse}-${orderId}` }) },
}

const wizard = createWizard(order, { context: { orderId: 'o-1', amount: 30 }, deps })
wizard.observe((event) => {
  if (['step.entered', 'step.done', 'child.started', 'flow.done'].includes(event.type)) {
    const path = event.path.length === 0 ? '(root)' : event.path.join('/')
    console.log(`${path.padEnd(8)} ${event.type}${'step' in event ? ` ${event.step}` : ''}`)
  }
})

await wizard.start()
const child = wizard.child('fulfil')
console.log(
  'child context:',
  JSON.stringify(child.getState().context),
  '| child current view:',
  child.getState().current,
)

await child.setInput('pick', { warehouse: 'west' })
await child.next()
await new Promise((r) => setTimeout(r, 0)) // let the carrier call resolve

console.log(
  'parent status:',
  wizard.getState().status,
  '| output:',
  JSON.stringify(wizard.getState().output),
)
console.log('snapshot children:', Object.keys(wizard.getSnapshot().children).join(', '))
wizard.dispose()
