---
'@openwizard/core': minor
---

Add durable sync or async view draft initializers and principal-scoped select projections. Mirror
sources can now authorize typed commands against the authenticated projection scope and return a
`FORBIDDEN` result without putting the scope on the wire.
