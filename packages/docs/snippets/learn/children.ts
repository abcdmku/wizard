import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

const address = defineWizard(
  { name: 'address', context: z.object({ country: z.string() }) },
  ({ view, steps }) => steps({ street: view({ input: z.object({ street: z.string().min(1) }) }) }),
)

export const checkout = defineWizard(
  { name: 'checkout', context: z.object({ country: z.string() }) },
  ({ child, step, steps }) => {
    const shipping = child(address, { context: ({ context }) => ({ country: context.country }) })
    const confirm = step({
      needs: { shipping },
      run: ({ needs }) => `Ship to ${needs.shipping.street}`,
    })
    return steps({ shipping, confirm })
  },
)

export async function runCheckout() {
  const run = checkout.create({ country: 'NL' })
  await run.start()
  const form = run.child('shipping') // the live child run
  await form.setInput('street', { street: 'Keizersgracht 1' })
  await form.next()
  const result = await run.awaitResult() // { status: 'done', output: 'Ship to Keizersgracht 1' }
  run.dispose()
  return result
}
