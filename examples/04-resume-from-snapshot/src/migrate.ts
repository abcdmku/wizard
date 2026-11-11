import { z } from 'zod'

// Validate the fields we change and preserve the rest of the snapshot envelope.
const PreviousSnapshot = z.looseObject({
  wizard: z.looseObject({ name: z.literal('expense-approval'), version: z.literal(1) }),
  state: z.looseObject({
    context: z.looseObject({ requestId: z.string(), amount: z.number().positive() }),
  }),
})

export function addCurrency(snapshot: unknown) {
  const previous = PreviousSnapshot.parse(snapshot)
  const wizard = { name: previous.wizard.name, version: 2 }
  return {
    ...previous,
    wizard,
    state: {
      ...previous.state,
      wizard,
      context: { ...previous.state.context, currency: 'EUR' },
    },
  }
}
