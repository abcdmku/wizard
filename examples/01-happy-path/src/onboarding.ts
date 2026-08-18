import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

/** The flow context: known facts at creation plus what the wizard collects along the way. */
const Context = z.object({
  email: z.email(), // known when the wizard is created (the sign-up form)
  company: z.string().optional(), // collected by the `profile` view
  role: z.enum(['founder', 'engineer', 'other']).optional(),
})
type Contact = z.infer<typeof Context>

/** Out-of-domain services the flow calls, injected with `createWizard(flow, { deps })`. */
export interface Deps {
  crm: { upsert(contact: Contact): { id: string } }
}

// `defineFlow` returns pre-bound step constructors: every hook below is typed by this
// context / deps without generics or casts.
const s = defineFlow({
  name: 'onboarding',
  context: Context,
  deps: boundary.trusted<Deps>(), // deps are built by the host, so no runtime check
})

export const onboarding = s.steps(
  {
    // A view waits for the user: `setInput()` fills the draft, `next()` parses it through
    // `input` (Zod here — any Standard Schema works) and rejects with issues, never throws.
    profile: s.view({
      input: z.object({
        company: z.string().min(1, 'company is required'),
        role: z.enum(['founder', 'engineer', 'other']),
      }),
      // The parsed draft is handed to later steps through the typed context.
      exit: ({ output, update }) => update(output),
      next: 'save',
    }),
    // A task runs as soon as the cursor arrives; sync or async, same code path.
    save: s.task(({ context, deps }) => deps.crm.upsert(context), { next: 'done' }),
    // A final step ends the flow; its `output` becomes the wizard's output.
    done: s.final({ output: ({ context }) => `${context.email} @ ${context.company}` }),
  },
  { start: 'profile' },
)
