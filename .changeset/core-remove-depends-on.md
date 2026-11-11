---
'@openwizard/core': minor
'@openwizard/devtools': minor
---

Remove the `dependsOn` step option. Steps are now linked two ways: `next` starts a step, and
`needs` waits for another step and passes its output on. A definition that still sets
`dependsOn` fails to type-check and throws `DEFINITION_INVALID` when it is built.

| Before | After |
|---|---|
| `dependsOn: ['audit']`, wait for a step | `needs: { audit }`, and ignore the value |
| The same, where a skipped `audit` should not stop the step | `needs: { audit: { optional: audit } }` |
| `dependsOn: { any: ['a', 'b'] }` | `needs: { first: { any: [a, b] } }` |
| `dependsOn` on a step listed in a router's `targets` | The same `needs`. The router still decides whether the step runs |
| `dependsOn` on a step another step starts with a static `next` | `needs` on both, for example `needs: { review, audit }` |

`needs` takes step objects, so create the producers first with `const audit = step(...)`.

Three differences from `dependsOn` matter when you migrate:

- A skipped producer skips a step with a plain need on it. `dependsOn` let the step run. Use
  `{ optional: producer }` to keep that.
- An `any` need waits for a producer that finished. A skipped producer does not satisfy it.
- A need starts its step once the producers finish, where `dependsOn` only held a step that
  something else started. The exception is below.

A step listed in the `targets` of a function `next` now starts only when that function returns
it. Its needs hold it and never start it. Before, a target with needs started as soon as its
producers finished, even when the router chose another branch, and a `not-taken` target came
back to life when a producer finished later.

Also removed, because only `dependsOn` used them: the `dependsOn` field of `FlowGraphNode`, the
`dependsOn` edge kind, its Mermaid and devtools labels, and the `NEVER_ACTIVATES` warning. A step
whose producers cannot be reached is reported as `UNREACHABLE`. The reason code
`deps-unmet:<id>` and the error `DEPS_UNREACHABLE` stay and now always refer to a need.
`EXCLUSIVE_JOIN` still warns about a step with plain needs on exclusive branches.

The manifest fingerprint of every wizard changes once, because the hashed structure no longer
has a `dependsOn` entry.
