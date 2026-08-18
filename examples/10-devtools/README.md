# 10: devtools (Vite + React)

Example 07's DAG pipeline running in a browser page with the
[`@openwizard/devtools`](../../packages/devtools/README.md) panel docked underneath, plus an
`approve` wait step so the page has an external event to send. The fake services take real time,
so you can watch the run move through the graph.

## What is in the panel

| Tab | What it gives you |
|---|---|
| Graph | `inspect(pipeline)` laid out by ELK, every card coloured by live status: the `retrying` pulse on `enrich`, the `waiting` dot on `approve`, the dashed and dotted edges |
| Events | every domain event as it happens, filterable |
| Inspector | click a card for its state record, its `explain()` reasons and its definition |
| Timeline | a `seq` slider you can scrub to see the state at any point of the run |

## Run it

```sh
pnpm --filter example-10-devtools dev     # open the printed URL; ctrl+shift+d toggles the panel
pnpm --filter example-10-devtools check   # tsc + test + vite build (what CI runs)
```

## What the test proves

A headless jsdom run clicks Start, waits for the retry and the approval, sends `review.approved`,
and checks the flow lands on `done` with the graph cards showing their final statuses. It also
checks the events tab counter equals `wizard.log().length`, so the panel saw every event the
wizard emitted.
