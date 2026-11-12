---
'@openwizard/opentelemetry': minor
---

Rename the attempt span and its attributes from `task` to `step`, the word the rest of OpenWizard
uses. Update dashboards, alerts and queries that read the old names.

| Before | After |
|---|---|
| span `openwizard.task` | span `openwizard.step` |
| `openwizard.task.attempt` | `openwizard.step.attempt` |
| `openwizard.task.retry` | `openwizard.step.retry` |
| `openwizard.task.retry_count` | `openwizard.step.retry_count` |
| `openwizard.task.run_id` | `openwizard.step.run_id` |
| `openwizard.task.resumed` | `openwizard.step.resumed` |
| `openwizard.task.outcome` | `openwizard.step.outcome` |
| `openwizard.task.will_retry` | `openwizard.step.will_retry` |
| `openwizard.error.kind` value `task` | `openwizard.error.kind` value `step` |

`openwizard.step.kind` now holds the step's kind from the wizard definition, `step`, where it used
to hold the fixed value `task`.
