# 07 — DAG pipeline (fan-out, parallel branches, AND-join, `explain()`)

A server-side ingest pipeline with no views at all: `ingest → (normalize ∥ enrich) → gate →
persist → done`. The same rule drives wizards, DAGs and hybrids: `next` is a navigation edge
(where completion arrives), `dependsOn` is data readiness (what must be done before an arrived
step may run).

What it shows

- Fan-out with `next: ['normalize', 'enrich']`: both branches arrive at once and run in parallel — the test proves it with fakes that take virtual time on the wizard's own `createTestScheduler()` and record `normalize:start@0, enrich:start@0, normalize:end@300, enrich:end@500`.
- The AND-join: `gate` is a `decision` with `dependsOn: ['normalize', 'enrich']`; the first branch to finish arrives there, but it stays `blocked` until both are done (`{ any: [...] }` would be an OR-join).
- `wizard.explain('gate')` while waiting: `not-activated, deps-unmet:normalize, deps-unmet:enrich` before anything arrived, then `phase: 'blocked', reasons: ['deps-unmet:enrich']`.
- `concurrency`: with `concurrency: 1` the branches are serialised and `explain('enrich')` says `concurrency-limit`.
- `autoRun: 'manual'` + `runReady()`: ready steps report `auto-run-manual` and only start when the host says so — stage by stage.
- Branches hand data on through the shared context (`update()` patches shallow-merge; each branch writes its own keys); the decision routes on the merged context.
- `inspect(flow)` returns the static graph (`next` / `dependsOn` / `start` edges, warnings) — what a visualizer or devtools panel consumes.

Run

```sh
pnpm --filter example-07-dag-pipeline check
pnpm --filter example-07-dag-pipeline start
```

Excerpt (`src/pipeline.test.ts`)

```ts
await wizard.start() // ingest (sync) → fan-out → both branches start at once
expect(timeline).toEqual(['normalize:start@0', 'enrich:start@0'])
expect(wizard.explain('gate').reasons).toEqual(['not-activated', 'deps-unmet:normalize', 'deps-unmet:enrich'])

sched.advance(300) // normalize finishes and arrives at the gate …
await settle()
expect(wizard.explain('gate')).toMatchObject({ phase: 'blocked', reasons: ['deps-unmet:enrich'] })

sched.advance(200) // enrich finishes → join satisfied → gate → persist → done
await settle()
expect(wizard.getState().output).toBe('stored 100 rows')
```
