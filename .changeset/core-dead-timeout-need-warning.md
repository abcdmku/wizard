---
'@openwizard/core': minor
---

`inspect(wizard).warnings` reports a new code, `SKIPPED_NEED`, for a `timeout.next` or `fallback`
target that has a plain need on the step that starts it:

```ts
const reply = step({ waitFor: { answered: () => {} }, timeout: { after: '1h', next: 'giveUp' } })
const giveUp = step({ needs: { reply }, run: () => 'gave up' })
```

A wait that times out is skipped, and so is a step that falls back. Neither has an output, so
`giveUp` was skipped every time the timeout fired, with no error and no warning. Declare the need
as `{ optional: reply }` and handle `undefined`, or remove the need.

`ManifestWarning['code']` gains `'SKIPPED_NEED'`. Code that switches over every warning code needs
a new case.
