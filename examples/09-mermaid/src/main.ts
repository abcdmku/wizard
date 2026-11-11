/** Print the checkout flow as Mermaid text. */
import { inspect, toMermaid } from '@openwizard/core/inspect'
import { checkoutFlow } from './checkout'

console.log('```mermaid')
console.log(toMermaid(inspect(checkoutFlow)))
console.log('```')
