# 01 — happy path (view → task → final)

The smallest useful wizard: a form (`view`) whose parsed draft feeds a task that calls an
out-of-domain service (`deps.crm`), then a `final` step. This is the Quickstart flow of the
root README (`src/onboarding.ts` is copied there verbatim).

What it shows

- `defineFlow` → pre-bound step constructors, so hooks are typed by the context / deps with no generics.
- A view's `input` boundary (Zod 4 here — any Standard Schema works): `setInput()` merges a draft, `next()` parses it and answers `{ ok: false, code: 'INVALID_INPUT', issues }` instead of throwing.
- `validate(step)` as a pure query over the current draft.
- The typed hand-off between steps: `exit: ({ output, update }) => update(output)` writes the parsed draft into the context; the task reads `context`.
- `deps` for out-of-domain services (`boundary.trusted<Deps>()`), replaced by an in-memory fake in the test.
- The sync-commit guarantee: with synchronous hooks the whole `next()` chain (parse → exit → task → final) is committed before the returned promise is awaited.
- `getSnapshot()`: versioned, JSON-safe, cached per state.

Run

```sh
pnpm --filter example-01-happy-path check   # typecheck against the built package + vitest
pnpm --filter example-01-happy-path start   # prints the event trace of one session
```

Excerpt (`src/onboarding.test.ts`)

```ts
// next() with an empty draft: the input boundary rejects it — a result, not a throw.
const rejected = await wizard.next()
expect(rejected).toMatchObject({ ok: false, reason: 'validation', code: 'INVALID_INPUT' })

await wizard.setInput('profile', { company: 'Acme', role: 'engineer' })

// Sync-commit guarantee: every hook is synchronous here, so the state is committed
// BEFORE the promise is awaited.
const pending = wizard.next()
expect(wizard.getState().status).toBe('done')
expect(await pending).toMatchObject({ ok: true, from: 'profile', to: 'save' })
```

The test also asserts the filtered event trace, e.g. `step.validationFailed:profile`,
`transition.rejected:profile`, … `step.runSucceeded:save`, `flow.done`.
