/** Print the checkout wizard as Mermaid text. */
import { inspect, toMermaid } from '@openwizard/core/inspect'
import { checkout } from './checkout'

console.log('```mermaid')
console.log(toMermaid(inspect(checkout)))
console.log('```')
