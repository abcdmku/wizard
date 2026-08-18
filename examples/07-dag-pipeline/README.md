# 07 — DAG pipeline (fan-out, parallel branches, AND-join, `explain()`, `when` / `skip()` / `progress()`)

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
- `when` (v0.2): `enrich` declares `when: ({ context }) => context.enrichment === 'on'` — evaluated once the step is ready; `false` skips it (`step.skipped { reason: 'when' }`), the AND-join treats skipped as done and the gate proceeds on `normalize` alone.
- `wizard.skip(step, reason?)` (v0.2): an operator skips the slow branch while it runs — the run is cancelled, the step is `skipped { reason: 'command' }`, its late result is ignored, and the join proceeds (a finished step cannot be skipped: `{ ok: false }`).
- `wizard.progress()` (v0.2): `{ done, total, ratio }` over the non-final steps — skipped counts as done, and `ratio` is 1 once the flow is done even when a branch (here `persist`) was never taken.
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
