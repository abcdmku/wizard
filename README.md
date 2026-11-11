# OpenWizard

OpenWizard runs typed wizards and workflows in TypeScript. A step runs work, collects a form, waits for an event or a deadline, chooses a branch or runs another wizard, and a run can be saved as JSON and resumed later.

```sh
npm install @openwizard/core zod
```

```ts title="packages/docs/snippets/learn/factory.ts"
import { defineWizard } from '@openwizard/core'
import { z } from 'zod'

export const hello = defineWizard(
  { name: 'hello', context: z.object({ name: z.string() }) },
  ({ step, steps }) => steps({ greet: step({ run: ({ context }) => `Hello, ${context.name}!` }) }),
)

export const result = hello.runSync({ name: 'Ada' })
if (result.status === 'done') {
  // biome-ignore lint/suspicious/noConsole: display the quickstart result
  console.log(result.output)
}
```

## Read next

- [Quickstart](./packages/docs/pages/getting-started.mdx). Install, define, run.
- [Guide](./packages/docs/pages/learn/index.mdx). Ten short pages, read in order.
- [Reference](./packages/docs/pages/packages/index.mdx). Every option of every package.
- [AGENTS.md for wizards](./packages/core/AGENTS.md). The model, the rules and one full example for coding agents. It ships inside `@openwizard/core`.

## Work on the repository

Node.js 22 or newer and pnpm 10.

```sh
pnpm install
pnpm build
pnpm test
pnpm --filter @openwizard/docs check
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full checks. Coding agents start with [AGENTS.md](./AGENTS.md).
