import { z } from 'zod'

// Validate the fields we change and preserve the rest of the snapshot envelope.
const PreviousSnapshot = z.looseObject({
  flow: z.looseObject({ name: z.literal('expense-approval'), version: z.literal(1) }),
  state: z.looseObject({
    context: z.looseObject({ requestId: z.string(), amount: z.number().positive() }),
  }),
})

export function addCurrency(snapshot: unknown) {
  const previous = PreviousSnapshot.parse(snapshot)
  const flow = { name: previous.flow.name, version: 2 }
  return {
    ...previous,
    flow,
    state: {
      ...previous.state,
      flow,
      context: { ...previous.state.context, currency: 'EUR' },
    },
  }
}
