# Contributing to OpenWizard

Keep changes focused, typed, and backed by a user-visible contract.

## Setup

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Development requires Node 22 and pnpm 10. Published packages support Node 20. CI checks Ubuntu,
Windows, and a Node 20 consumer built from packed artifacts.

## Code rules

1. Keep one public concept for each job. Add an overload only when it preserves the same behavior
   and avoids a second API.
2. Every public field needs a runtime consumer and a test.
3. Define each type extractor once. Reuse `InputOf`, `OutputOf`, `PayloadOf`, `Ctx`, and `StepId`.
4. A new export needs a unit test, a type assertion when generic, and public TSDoc. Run
   `pnpm docs:gen` after changing exports.
5. Do not expose `any` or unchecked assertions in generated declarations. Run
   `pnpm check:api:update` after an intentional API change.
6. Put compile-time contracts in `tests/**/*.test-d.ts`. `pnpm test:canary` verifies that the type
   test harness catches a real error.
7. Treat examples as tests. Extend the smallest relevant example when a change affects normal use.
8. Validate untrusted data at the correct boundary. Context is parsed at creation, input events at
   `send`, view drafts when validated or left, and stored values at resume.
9. Use `boundary.trusted<T>()` only for host-constructed data. Explain why the value is trusted.
10. Add a changeset for a user-facing change to any published `@openwizard/*` package.
11. Record non-obvious architecture choices in `docs/design/adr/` and link them from
    `DECISIONS.md`.
12. Keep files and functions focused. Split code when separate responsibilities become hard to
    test or review.
13. Tests must prove behavior a caller relies on. Avoid duplicate coverage and assertions that
    only prove a component rendered.

## Repository layout

```text
packages/core           flow authoring, runtime, persistence, projections, and Mirror
packages/durable        leases, fencing, deduplication, and durable timers
packages/drizzle        PostgreSQL and asynchronous SQLite durable stores
packages/react          React bindings for FlowRun and Mirror
packages/devtools       graph, event log, inspector, and timeline UI
packages/effect         Effect 3 task adapter
packages/effect-v4      Effect 4 beta task adapter
packages/opentelemetry  tracing from committed run events
packages/webhooks       run HTTP API and incoming or outgoing webhooks
packages/docs           documentation site and compiled snippets
examples                runnable workspace examples with tests
docs/design             historical design notes and accepted ADRs
scripts                 release and contract checks
```

## Pull requests

- Describe the behavior change and the tests that prove it.
- Keep unrelated edits out of the pull request.
- Run the relevant package checks before the full `pnpm release:check` suite.
- For machine changes under `packages/core/src/machine`, extend the focused machine tests and an
  end-to-end flow when behavior crosses the interpreter boundary.
