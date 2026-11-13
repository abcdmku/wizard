---
"@openwizard/devtools": minor
"@openwizard/dev": patch
---

The graph shows a whole wizard at a readable size. Step cards are compact: the step id, then one row with its status, or with its kind (`form`, `wait`, `timer`, `each`, `child`, `route`) and the one fact that tells most. A kind that repeats the step id is left out. Everything else is in the card's tooltip. Step ids, status words and edge labels stay at 11px or more on screen whenever the whole graph is drawn at a readable size. Edges follow right-angled routes that keep clear of the cards and leave room for their labels, and two edges between the same pair of steps are drawn as one line that carries both labels. A step that needs any one of several steps says so on a third line inside its card (`any of ack, escalate`, or `any of 2 steps` when the names do not fit), so nothing covers an edge or an arrowhead. A step that runs per item keeps `each · 2 at a time` on that line while the run is live. Edge labels read as plain phrases: `need: values`, `optional need: by`, `times out after 48h`, `falls back`. A line that says two things puts each on its own line (`optional need: by` above `times out after 48h`). Durations read as whole hours under 72 (`48h`), otherwise as the largest whole unit (`7d`, `5m`).

`<WizardGraph>` has new props:

- `direction`: `right`, `down` or `auto` (default). `auto` lays the layers top to bottom unless running them right draws the graph clearly larger, or the graph is one short row of steps.
- `autoHeight`: the graph sets its own height to fit the wizard, between a minimum and a maximum. A short chain gets only the height it needs.
- `attention`: the keys of the steps that wait on a person. They show `waiting on you`. A step that is undoing, done or failed keeps its word and gets a ring instead.
- `ended`: the run has ended, so a step it never started shows `not run`.
- `runStatus`: the run's status. While the run is undoing (`compensating`), or once it is done, failed, cancelled, halted or undone, a step it never started shows `not run`.
- `wheelZoom`: pass `false` so the mouse wheel scrolls the page. Pinch and Ctrl with the wheel still zoom, by 1.2 for each wheel notch.
- `attribution`: pass `false` to hide the React Flow link when you credit React Flow elsewhere.

Status words are a fixed set: running, waiting on you, waiting, retrying, failed, undoing, undone, done, skipped, cancelled, blocked and not run. A step a live run has not started is `blocked` while it can still start and `not run` once it cannot: a need it cannot run without was skipped or failed, every step of an `any` need was, or every way into it closed (a timeout target once the wait finished in time, a fallback once the step succeeded). Running is blue; waiting, waiting on you and retrying are amber. A step that retries shows `retries 2` before it runs and `2 of 3` while it retries or after it failed; `collectStatuses` now reports each step's `attempt`. A graph that fits at a readable size is shown whole and stays whole as the run moves on, and a narrow pane such as a phone always shows the whole graph. When the graph follows a run that is too large to show whole, the view holds whole steps, a step cut by the edge is covered, and a button such as `← 3 steps` moves the view to the steps beyond that edge. A focused step that is out of view is brought into view by the least movement, Enter or Space selects it, and Escape clears the selection. The entry marker is no longer a tab stop. The path the run took is drawn dark, including a timeout or fallback line the run went along, which keeps its dashes; a timeout or fallback line the run can no longer take fades. Fitting the graph, and the fit button, keep the edge labels in view as well as the steps. In a narrow pane a graph too wide to read is laid out again as narrow as it goes, so step ids stay at 11px or more on a phone.

In the dev UI's dark mode, the graph's attention ring and current-step ring show again.
