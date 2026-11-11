---
'@openwizard/core': minor
'@openwizard/devtools': minor
---

Move the flow manifest to `@openwizard/core/inspect`: `inspect`, `toMermaid`, `toJSONSchema`,
`formatTrace`, `traceLine` and the `FlowGraph`, `FlowGraphNode`, `FlowGraphEdge`, `GraphRetry`,
`JSONSchema` and `FlowWarning` types. The main entry no longer exports them.

`inspect(flow)` returns the full manifest: `description` and `meta`, draft 2020-12 JSON Schemas of
the context, event payloads, view input and step outputs (read through Standard JSON Schema, so
Zod 4 and ArkType work; other boundaries give `undefined`), and per step `waitsFor`, `completes`,
`compensable`, `retry`, `child` and declared `targets`, drawn as `route` edges. `fingerprint`
detects structure and schema drift. It is not a behaviour hash: hook bodies, `when` guards, retry
and timeouts do not change it. A new `EXCLUSIVE_JOIN` warning flags an AND-join over alternative
branches. `toMermaid` output now parses with Mermaid: quoted edge labels (`needs: first (any)`), a
title, step labels, event nodes, and child subgraphs titled with the child flow name.

Every entry of `@openwizard/core` shares one runtime, so `inspect()` accepts flows built with
`boundary.trusted()` and the errors it throws pass `instanceof WizardError`.

Devtools imports the manifest from `@openwizard/core/inspect`. It no longer re-exports
`FlowGraphNode` / `FlowGraphEdge`, so import them from there. Route edges are drawn dashed, with no
`?` port when targets are declared. The event log and timeline use `traceLine`.
