---
"@openwizard/devtools": patch
---

The graph shows a whole wizard at a readable size. Step cards are compact: the step id, then one row with its status, or with its kind (`form`, `wait`, `timer`, `each`, `child`, `route`) and the one fact that tells most. Everything else is in the card's tooltip. Edges follow right-angled routes that keep clear of the cards and leave room for their labels, and two edges between the same pair of steps are drawn as one line.

`<WizardGraph>` has new props:

- `direction`: `right`, `down` or `auto` (default). `auto` lays the layers top to bottom when that draws the graph larger, as in a narrow pane.
- `autoHeight`: the graph sets its own height to fit the wizard, between a minimum and a maximum.
- `attention`: the keys of the steps that wait on a person. They show `waiting on you`.
- `wheelZoom`: pass `false` so the mouse wheel scrolls the page. Pinch and Ctrl with the wheel still zoom.

Status words are a fixed set: running, waiting on you, waiting, retrying, failed, undoing, undone, done, skipped, cancelled and blocked. A step that retries shows `retries 2` before it runs and `attempt 2 of 3` while it retries or after it failed; `collectStatuses` now reports each step's `attempt`. When the graph follows a run that is too large to show whole, the view holds whole steps, a step cut by the edge is covered, and a button such as `← 3 steps` moves the view to the steps beyond that edge. A focused step that is out of view is brought into view, and Enter or Space selects it.
