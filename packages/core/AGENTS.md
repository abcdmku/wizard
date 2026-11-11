# OpenWizard for coding agents

Read this before you write, change or explain a wizard. It ships inside `@openwizard/core`, so it matches the installed version.

## Read a wizard before you change it

```ts
import { inspect, toMarkdown } from '@openwizard/core/inspect'

console.log(toMarkdown(inspect(wizard)))
```

`toMarkdown` prints one page: a diagram, a table of when each step starts, what it does and where it leads, then each step's typed needs, retry, timeout, undo hook and schemas, then the context fields, events and warnings. `inspect(wizard)` returns the same facts as JSON. Neither one runs a hook.

For a run that exists:

| Question | Call |
|---|---|
| Why has this step not started? | `run.explain('pay')` returns its status, phase and reasons such as `deps-unmet:order` |
| What is the run waiting on? | `run.waitingFor()` lists views, event waits and sleeps, including those in children |
| What happened so far? | `formatTrace(run.log())` from `@openwizard/core/inspect` prints one line per event |

## The model

A wizard is a definition. `wizard.create(input)` returns a run, which holds the context, each step's status and output, timers and buffered events. A snapshot of a run is JSON, and `wizard.resume(snapshot)` continues it.

There are three constructors. The options you pass decide what a step does.

| Declaration | The step |
|---|---|
| `view({ input })` | Collects a draft from a person and validates it on `run.next()` |
| `step({ run })` | Runs work. The return value is the step's output |
| `step({ each, run })` | Runs work per item. The output is an array in item order |
| `step({ waitFor })` | Waits for a declared event |
| `step({ sleep })` | Waits until a stored deadline |
| `step({ next, targets })` | Routes without doing work |
| `child(childWizard, { context })` | Runs another wizard. Its output is the step's output |

## Connect steps

| Option | Use it when |
|---|---|
| `needs: { order }` | The step reads another step's output. It starts once every need has finished, and every hook receives `needs.order`, typed |
| `needs: { approval: { any: [a, b] } }` | Exactly one of several branches produces the value |
| `needs: { extra: { optional: a } }` | The step runs even if the producer was skipped. The value may be `undefined` |
| `next: 'ship'` | The next step shares no data with this one |
| `next: fn` with `targets: [...]` | The step chooses a branch. Targets it does not return are skipped |
| `when: fn` | Skip the step when the function returns false |

Create producers before the steps that need them, so `needs` can refer to the step objects.

A step can need another step only to wait for it and ignore the value. A step listed in `targets` starts only when the function `next` returns it. Its needs hold it until they are met and never start it.

## Rules

1. Pass data between steps with `needs`. Keep `context` for facts known when the run is created. A step that reads an optional context field written by an earlier hook has a hand-off the compiler cannot check.
2. Give the wizard and every step a `description`. Hooks are opaque to `inspect`, so the description is the only account of what a step is for.
3. Call databases and services through `deps`. They never enter a snapshot.
4. Declare every external event under `events` with a schema. `run.send` parses the payload before a handler sees it.
5. Commands return values. Check `ok` on `next`, `setInput` and `send`, and check `status` on a result before reading `output`.
6. An external call can repeat after a crash. Pass `idempotencyKey` from the run arguments to any service that charges, sends or books.
7. `retry: { retries: 2 }` allows two more runs after the first one fails, three in total.
8. A wait that times out is skipped, so a step that needs its output is skipped too. A step that must run anyway declares the need as `{ optional: wait }` and handles `undefined`.
9. Call `run.dispose()` when you are done with a run from `wizard.create`. `wizard.run(input)` creates, runs and disposes in one call.

## Example

One wizard with a form, parallel work, a branch, an event wait and a typed join.

```ts title="packages/docs/snippets/agents/refund.ts"
import { boundary, defineWizard } from '@openwizard/core'
import { inspect, toMarkdown } from '@openwizard/core/inspect'
import { z } from 'zod'

/** Services the host supplies. They never enter a snapshot. */
export interface RefundDeps {
  orders: { find(orderId: string): Promise<{ total: number }> }
  payments: {
    refund(
      orderId: string,
      amount: number,
      options: { idempotencyKey: string },
    ): Promise<{ refundId: string }>
  }
}

export const refund = defineWizard(
  {
    name: 'refund',
    description: 'Refunds part of an order. A refund of 100 or more waits for a manager.',
    context: z.object({ orderId: z.string() }),
    deps: boundary.trusted<RefundDeps>(),
    events: { 'refund.approved': z.object({ by: z.string() }) },
  },
  ({ step, view, steps }) => {
    const request = view({
      description: 'The customer says how much to refund and why.',
      input: z.object({ amount: z.number().positive(), reason: z.string().min(1) }),
    })
    const order = step({
      description: 'Loads the order, so the refund cannot exceed what was paid.',
      run: ({ context, deps }) => deps.orders.find(context.orderId),
    })
    const route = step({
      description: 'Sends large refunds to a manager and approves small ones by policy.',
      needs: { request },
      targets: ['managerApproval', 'policyApproval'],
      next: ({ needs }) => (needs.request.amount >= 100 ? 'managerApproval' : 'policyApproval'),
    })
    const managerApproval = step({
      description: 'Waits for a manager to approve the refund.',
      waitFor: { 'refund.approved': ({ payload }) => ({ done: { by: payload.by } }) },
    })
    const policyApproval = step({
      description: 'Approves the refund without a person.',
      run: () => ({ by: 'policy' }),
    })
    const pay = step({
      description: 'Returns the money. The idempotency key makes a repeated call safe.',
      needs: { request, order, approval: { any: [managerApproval, policyApproval] } },
      run: async ({ context, deps, needs, idempotencyKey }) => {
        const amount = Math.min(needs.request.amount, needs.order.total)
        const { refundId } = await deps.payments.refund(context.orderId, amount, { idempotencyKey })
        return { refundId, amount, approvedBy: needs.approval.by }
      },
      idempotencyKey: ({ context }) => `refund:${context.orderId}`,
      retry: { retries: 2, backoff: 'exponential' },
    })
    return steps(
      { request, order, route, managerApproval, policyApproval, pay },
      { start: ['request', 'order'] },
    )
  },
)

/** The page a person or an agent reads to learn what the wizard does. */
export const refundPage = toMarkdown(inspect(refund))
```

Drive it like this:

```ts
const run = refund.create({ orderId: 'o-2' }, { deps })
await run.start()
await run.setInput('request', { amount: 900, reason: 'never arrived' })
await run.next() // validates the draft; { ok: false, issues } if it is invalid
run.waitingFor() // [{ kind: 'event', step: 'managerApproval', events: ['refund.approved'] }]
await run.send('refund.approved', { by: 'grace' })
const result = await run.awaitResult() // { status: 'done', output: { refundId, amount, approvedBy } }
run.dispose()
```

## Check your work

- Run the type checker. Unknown step ids, a missing `targets`, and a wrong `needs` type are compile errors.
- Import the module. A broken definition throws `WizardError` with code `DEFINITION_INVALID` and lists every problem.
- Read `inspect(wizard).warnings`. The codes are `UNREACHABLE`, `NAV_CYCLE`, `EXCLUSIVE_JOIN`, `MULTIPLE_SINKS` and `NO_SINKS`. `MULTIPLE_SINKS` means the output depends on which branch finished last, so add an `output` selector to the wizard options.
- Test time with `createTestScheduler()` from `@openwizard/core/testing`. Pass it as `scheduler` and call `advance(ms)` to fire retries, sleeps and timeouts.
