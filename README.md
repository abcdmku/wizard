# OpenWizard

OpenWizard runs typed wizards and workflows in TypeScript. Steps collect input, run work, wait for events or timers, branch, join typed outputs, and compose child wizards.

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

Use `wizard.create(input)` for a live Run. Use `wizard.run(input)` to return an outcome when the run finishes, halts, or waits for input or an event. Halted and waiting outcomes include a snapshot to resume. `wizard.provide(services)` binds deps and leaves missing keys required by the type.

A Wizard is the definition itself. Pass it directly to React bindings, projections, inspectors, HTTP APIs, and durable hosts. Each creation call has independent state.

Read [Build a wizard](./packages/docs/pages/getting-started.mdx) for forms, typed data joins, services, composition, and execution. The [core API reference](./packages/docs/pages/api/core.mdx) lists contracts.

For production, read [recovery and hosting](./packages/docs/pages/advanced/index.mdx). External effects may repeat after a crash. Pass stable idempotency keys to services that enforce them. The [reference systems](./packages/docs/pages/examples/reference-systems.mdx) exercise browser, API, worker, and persistence boundaries.

## Work on the repository

Node.js 22 or newer and pnpm 10. The published packages run on Node.js 20.

```sh
pnpm install
pnpm build
pnpm test
pnpm --filter @openwizard/docs check
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full checks. Coding agents start with [AGENTS.md](./AGENTS.md).
