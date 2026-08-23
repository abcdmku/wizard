# OpenWizard

OpenWizard runs TypeScript workflows that may wait, retry failed work, and continue after a process restart.

## Install

```sh
npm install @openwizard/core zod
```

## Smallest example

Define a flow:

```ts title="examples/01-happy-path/src/hello-flow.ts"
import { defineFlow } from '@openwizard/core'
import { z } from 'zod'

const hello = defineFlow({
  name: 'hello',
  context: z.object({ name: z.string() }),
})

export const helloFlow = hello.steps({
  done: hello.final({
    output: ({ context }) => `Hello, ${context.name}!`,
  }),
})
```

Create one run:

```ts title="examples/01-happy-path/src/main.ts"
import { createRun } from '@openwizard/core'
import { helloFlow } from './hello-flow'

const run = createRun(helloFlow, {
  context: { name: 'Ada' },
})

await run.start()

const result = await run.awaitResult()
if (result.status === 'done') console.log(result.output)

run.dispose()
```

`defineFlow()` describes the workflow. `createRun()` creates one execution of it. Nothing runs until `start()`.

## Why use it

OpenWizard becomes useful when work cannot be represented safely by one promise chain. A run can persist retry deadlines, wait for correlated events, resume after a restart, compensate completed side effects, fan out into dependent branches, and expose a restricted projection to a browser.

For multiple workers, `@openwizard/durable` adds leases, fencing, compare-and-swap snapshots, duplicate command results, and timer claims. External task effects remain at-least-once, so OpenWizard passes stable idempotency keys to services that can enforce them.

Read [getting started](./packages/docs/pages/getting-started.mdx), then follow the [learning path](./packages/docs/pages/learn/index.mdx). The [recipes](./packages/docs/pages/recipes/index.mdx) solve common problems with complete examples.

Read [why the deep features matter](./packages/docs/pages/advanced/index.mdx) for the production failure model and the guarantees behind recovery, durability, projections, and replay.

## Work on the repository

OpenWizard requires Node.js 20 or newer and pnpm 10.

```sh
pnpm install
pnpm build
pnpm test
pnpm --filter @openwizard/docs check
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full set of checks.
