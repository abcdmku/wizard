# 07: DAG pipeline (fan-out, parallel branches, AND-join, `explain()`)

A server-side ingest pipeline with no views at all: fetch rows, normalize and enrich them in
parallel, then a gate decides whether the batch is good enough to persist. The same two rules
that drive wizards drive DAGs: `next` is a navigation edge, `dependsOn` is data readiness.

## What it shows

| Piece | What it does |
|---|---|
| `next: ['normalize', 'enrich']` | fans out, so both branches run at once, each patching its own keys into the shared context |
| `dependsOn: ['normalize', 'enrich']` on `gate` | an AND-join, and while it is blocked `explain('gate')` says exactly why |
| `concurrency: 1` | serialises the branches without touching the graph |
| `autoRun: 'manual'` | the host drives the pipeline stage by stage with `runReady()` |
| `when` on `enrich`, and `wizard.skip()` | skip by rule or by hand mid-run, and the join counts a skipped step as done |
| `inspect(flow)` | the static graph as data, which example 09 renders as Mermaid |

## Run it

```sh
pnpm --filter example-07-dag-pipeline start   # prints the graph, then a timed run
pnpm --filter example-07-dag-pipeline check   # typecheck + vitest
```

## What the tests prove

The fakes take virtual time from the same `createTestScheduler()` the wizard uses and record a
timeline, so the parallelism claim is testable for real. The other tests cover the serialised
run, the stage-by-stage run, the low-quality route to quarantine, and both kinds of skip.

```ts
await wizard.start() // ingest is sync, so the fan-out starts both branches together
expect(timeline).toEqual(['normalize:start@0', 'enrich:start@0'])

sched.advance(300) // normalize arrives at the gate, enrich has not
await settle()
expect(wizard.explain('gate')).toMatchObject({ phase: 'blocked', reasons: ['deps-unmet:enrich'] })

sched.advance(200) // join satisfied, so gate routes, persist runs, flow ends
await settle()
expect(wizard.getState().output).toBe('stored 100 rows')
```
