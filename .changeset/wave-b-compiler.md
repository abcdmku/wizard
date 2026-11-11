---
'@openwizard/core': minor
---

Compile callback-authored wizards with object step configs, named data joins, map steps, durable sleeps and static fallback edges. Resolve object references across routing, gates, joins, timeouts, fallback and view event handlers. Reject invalid definitions before a run starts, including missing routing targets, empty graph declarations, foreign or duplicate step references and dependency cycles.

Use normal successors and data consumers to determine sink outputs. Fallback and wait timeout edges preserve the source's happy-path output. Inspection reports named join modes, map and sleep facts, recovery edges and warnings for missing or multiple sinks; Mermaid and structural fingerprints reflect these patterns. Inspect manifests omit unbounded item concurrency so they remain JSON serializable.
