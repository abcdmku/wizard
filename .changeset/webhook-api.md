---
'@openwizard/core': minor
'@openwizard/webhooks': minor
---

Add `createHTTP` for signed Standard Webhooks receivers, outbound callback subscriptions, and
authenticated run REST APIs. Outgoing subscriptions can now inherit the flow's automatic typed run
events, including exact descendant paths and payloads through the supported nesting depth, without
a second schema registry. The subscription API and delivery queue remain tenant-scoped, signed,
leased, retryable, and auditable. Run API paths and scopes derive from the flow by default, and the
high-level API uses a tenant-scoped run data layer.
