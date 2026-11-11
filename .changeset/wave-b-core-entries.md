---
'@openwizard/core': minor
---

Move mirror creation, frame sources, transport and wire types to
`@openwizard/core/mirror`. The main, mirror, inspect and testing entries share
one runtime. Publish the wizard/run API, typed joins, durable mapped recovery,
per-item child access, and optimistic command guards in every supported module format.

The expanded core measures about 54 kB minified with Brotli, up from 47.4 kB
before this pass. Its size limit is now 55 kB. A bundle audit found no external
dependency inflation; the added map recovery and child coordination remain in core.
