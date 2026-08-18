# 01: happy path (view, task, final)

The smallest wizard that does something useful: a `profile` view collects a form, a `save` task
pushes it to a CRM, a `done` final step returns the wizard's output. `src/onboarding.ts` is the
quickstart from the root README, embedded there byte for byte.

## What it shows

| Piece | What it does |
|---|---|
| `defineFlow` | returns step constructors already bound to the context and deps types, so no hook needs a generic |
| the view's `input` | `next()` parses the draft, and a bad one comes back as `{ ok: false, code: 'INVALID_INPUT', issues }` |
| the view's `exit` | writes the parsed output into the context, where the `save` task reads it |
| `boundary.trusted<Deps>()` | the CRM is injected, so the test passes an in-memory fake |

## Run it

```sh
pnpm --filter example-01-happy-path start   # prints the event trace of one session
pnpm --filter example-01-happy-path check   # typecheck against the built package + vitest
```

## What the tests prove

`src/onboarding.test.ts` walks one session, asserts the event trace step by step, and checks
that `getSnapshot()` survives a JSON round trip. It also pins the sync-commit guarantee:

```ts
const pending = wizard.next() // every hook in this flow is synchronous
expect(wizard.getState().status).toBe('done') // committed before the promise is awaited
```
