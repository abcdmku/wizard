/**
 * Runnable walk-through: `pnpm --filter example-09-mermaid start`.
 * Prints the checkout flow as a Mermaid flowchart — paste the output into https://mermaid.live
 * (or a Markdown file that renders Mermaid).
 */
import { inspect, toMermaid } from '@openwizard/core'
import { checkout } from './checkout'

console.log('```mermaid')
console.log(toMermaid(inspect(checkout)))
console.log('```')
