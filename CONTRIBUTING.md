# Contributing to OpenWizard

Thanks for helping. This document is short on ceremony and long on the few rules that keep the library small and trustworthy.

## Setup

```bash
pnpm install
pnpm build        # builds packages/* with tsdown
pnpm typecheck    # tsc over src + tests (tests are NOT excluded — that was a v1 mistake)
pnpm test         # vitest, including *.test-d.ts type tests
pnpm lint         # biome
```

Node ≥ 22 to develop and build (the tsdown/unrun toolchain needs `Promise.withResolvers`); the published packages run on Node ≥ 20, which CI proves with a Node 20 consumer job that runs the tests and examples against the built artifacts. pnpm 10 (`corepack enable` picks the pinned version). Windows is a first-class dev platform; CI runs ubuntu + windows.

## The rules

1. **One canonical way.** One authoring path (`defineFlow` + `s.view/task/wait/decision/flow/final`), one live object (`Wizard`), one wire door (`dispatch(Command)`). No aliases, no overloads that branch on argument shape.
2. **No field without a consumer.** A property in a public type must be read by the runtime and covered by a test. If you cannot point at both, delete the field.
3. **One extractor per concept.** `InputOf`, `OutputOf`, `PayloadOf`, `Ctx`, `StepId`, … exist exactly once. Do not add a second way to get the same type.
4. **Every export earns its place.** A new export needs: a unit test, a `.test-d.ts` assertion if it is generic, TSDoc with `@public`, and it will appear in the generated export table (`pnpm docs:gen`).
5. **No `any` and no `as` in the public surface.** `api/*.d.ts` is diffed in CI; if you change it, run `pnpm check:api:update` and add a changeset explaining why.
6. **Type tests must run.** Put type assertions in `tests/**/*.test-d.ts`. `pnpm test` runs them through the TypeScript checker; `pnpm test:canary` proves the harness fails on a real error.
7. **Examples are tests.** Every `examples/*` folder has a test that runs the flow end to end and asserts on the event log. New behavior needs an example or an extension of one.
8. **Boundaries are the only doors.** Data enters a wizard through `context`, `setInput`, `send`, or `resume`, each through a declared boundary. `boundary.trusted<T>()` and `!` in examples need a one-line comment saying why.
9. **Changesets.** User-facing changes to `@openwizard/core` or `@openwizard/react` need `pnpm changeset`.
10. **Decisions are written down.** Non-obvious design choices go in `docs/design/adr/` and `DECISIONS.md`.
11. **Files stay small.** Under ~400 lines in most cases; split by responsibility (one message family, one event family, one component) rather than growing a file.
12. **Functions do one thing.** No pass-through wrappers (`foo()` that only calls `bar()`), no one-line helpers used once — inline them.
13. **No useless tests.** A test must prove behaviour a user relies on or a spec rule. No render-smoke tests that assert nothing, no duplicated cases across suites; prefer one end-to-end scenario over many micro-tests of internals.

## Layout

```
packages/core     @openwizard/core   authoring, machine (decide/apply/plan), interpreter, wizard façade, persistence, projections, mirror, inspect
                  @openwizard/core/testing  (src/testing.ts) createTestScheduler + createLocalTransport — test helpers, never in an app bundle
packages/react    @openwizard/react  bindReact() hooks over Wizard | Mirror
examples/*        runnable, tested examples (each is a workspace package)
docs/design       architecture plan + ADRs
scripts/          governance scripts (export tables, doc imports, api snapshot, public tags, canary)
```

## Pull requests

- Keep PRs focused; describe the behavior change and the tests that prove it.
- CI must be green on ubuntu and windows.
- If a change touches the machine (`packages/core/src/machine/**`), include a golden scenario or extend one (`packages/core/tests/scenarios/`).
