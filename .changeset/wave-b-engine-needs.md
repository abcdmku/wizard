---
'@openwizard/core': minor
---

Activate typed data joins from their producers without explicit next edges. Partial joins report DEPS_UNREACHABLE when remaining producers never activate. Required needs propagate skipped outputs, any needs choose an actual completion, and optional needs allow absent outputs. Untaken branches skip unreachable successors while alternate timeout paths can reactivate their joins. Explicitly invalidated work stays available for navigation and rerunning.
