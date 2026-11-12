---
'@openwizard/core': minor
---

Use ordinary synchronous `waitFor` handlers. Their context updates and handler
results commit together behind one persistence barrier, so a crash cannot leave
the updated context ahead of the wait's completion. Tagged wait reducers are removed.
