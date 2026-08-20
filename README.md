# OpenWizard

OpenWizard is a typed TypeScript runtime for long-running, event-driven flows.

## Start here

```sh
pnpm add @openwizard/core zod
```

```ts title="examples/01-happy-path/src/onboarding.ts"
import { boundary, defineFlow } from '@openwizard/core'
import { z } from 'zod'

const Context = z.object({
  email: z.email(),
  company: z.string().optional(),
  role: z.enum(['founder', 'engineer', 'other']).optional(),
})
type Contact = z.infer<typeof Context>

export interface Deps {
  crm: { upsert(contact: Contact): { id: string } }
}

const onboarding = defineFlow({
  name: 'onboarding',
  context: Context,
  deps: boundary.trusted<Deps>(), // The host constructs dependencies.
})

export const onboardingFlow = onboarding.steps(
  {
    profile: onboarding.view({
      input: z.object({
        company: z.string().min(1, 'company is required'),
        role: z.enum(['founder', 'engineer', 'other']),
      }),
      exit: ({ output, update }) => update(output),
      next: 'save',
    }),
    save: onboarding.task(({ context, deps }) => deps.crm.upsert(context), { next: 'done' }),
    done: onboarding.final({ output: ({ context }) => `${context.email} @ ${context.company}` }),
  },
  { start: 'profile' },
)
```

Continue with [getting started](./packages/docs/pages/getting-started.mdx), then read the
[concepts in order](./packages/docs/pages/concepts/index.mdx). The
[integration guides](./packages/docs/pages/integrations/index.mdx),
[examples](./packages/docs/pages/examples/index.mdx), and
[API reference](./packages/docs/pages/api/index.mdx) cover the rest.

## Repository

```sh
pnpm install
pnpm build
pnpm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for repository checks.
