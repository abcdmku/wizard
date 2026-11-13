---
'@openwizard/devtools': minor
'@openwizard/dev': patch
---

`<WizardGraph>` remembers the layout and height of a graph it has drawn, so it opens in place the next time. `prepareGraph(inspect(wizard), { width, autoHeight })` lays a graph out before it is shown. The dev UI prepares every wizard, keeps a run on screen while the next card arrives, and no longer opens a run on a loading line.
