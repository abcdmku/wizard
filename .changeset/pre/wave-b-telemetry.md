---
'@openwizard/opentelemetry': minor
---

Instrument `Run` instances created by a wizard. Instrumentation sends preserve `eventId` and
`correlationId`, accept the same typed event inputs as the run, and retain incoming trace links
without copying delivery ids or payloads into spans.

A duplicate delivery's incoming trace context cannot become the link for a later accepted
event while sends are concurrent.
