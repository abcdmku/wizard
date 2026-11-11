# ADR-001: Authoring types and checked assembly

- Status: accepted on 2026-08-18, amended on 2026-10-13.
- Scope: constructor inference, step references, dependency joins, wizard output, and provided services.
- Implementation: [authoring types](../../../packages/core/src/authoring/types/), [compiler](../../../packages/core/src/authoring/compile/), and [type tests](../../../packages/core/tests/types/).
- Toolchain for the recorded measurements: TypeScript 5.9.3, Node 24.14.0, Windows 11.

## Decision

Use pre-bound constructors inside `defineWizard`, then validate the actual step map with `steps(map, { start? })`.

The [parallel example](../../../packages/docs/snippets/recipes/parallel.ts) shows the checked assembly and inferred producer outputs.

A constructor knows its wizard's context, events, and deps. It infers facts from its own configuration, including output, error data, item type, needs, references, and targets. It cannot inspect sibling declarations that have not been assembled.

`steps` checks those facts against the whole map. Errors name the offending step or option instead of widening the wizard's ids and outputs. The returned Wizard is the definition and owns creation, resume, convenience execution, and dependency provisioning.

The compact public step map carries kind and inferred facts. It does not repeat every hook signature in every derived type. This keeps editor hovers and declaration output usable for large definitions.

## Why assembly validates references

Constraining the map before inference can turn literal ids into `string` and step outputs into a broad constraint. Conditional checks after inference preserve the actual map.

The assembled map checks:

- Literal ids in static edges and entry steps.
- Step-object membership and declared dynamic targets.
- Event names and handler return contracts.
- Nonempty step maps, start lists, waits, and any-needs.
- Constructor options and invariant context, event, and dependency bindings.

The compiler repeats the checks needed for JavaScript callers and values that crossed a trusted boundary. It resolves each object reference to one map id and rejects a step object declared under multiple keys.

A dynamic `next` requires `targets`. Its return type is constrained to that list. The runtime also checks the returned value because a callback can read outside data or escape a type check.

## Typed data dependencies

A `needs` entry takes a previously created step object. Plain needs supply that step's output, any-needs supply the first completed alternative's output, and optional needs supply an output or `undefined`.

Every consumer hook receives the inferred needs map. This replaces untyped sibling-output lookup inside hooks. `dependsOn` remains a control gate and does not supply data or activate the consumer.

A timed wait can finish with `undefined` when its deadline expires. Its `OutputOf` includes that value, and a consumer's typed need must handle it even when the need itself is required.

`BoundTo` is invariant in context, events, and deps. A step from a different binding cannot enter a map merely because one context is a structural subset of another.

Reusable modules must keep reference parameters generic, such as `L extends AnyStep`. Annotating a parameter as the broad `AnyStep` loses its concrete output and reference facts. A module that only creates steps can accept `StepApi<C, Ev, D>`, as the [composition snippet](../../../packages/docs/snippets/learn/factory-composition.ts) does.

## Output inference

Assembly computes each step's sink role once. A step is inner when it has a static successor through `next` or `targets`, or another step consumes it through `needs`.

Fallback and wait-timeout edges are alternate paths. They do not make the original step inner, so a successful task with a fallback can still provide the happy-path result.

Without a wizard-level output selector, `FlowOutput` is the union of sink outputs. Conditions and alternate branches can skip sinks, so the type includes `undefined` when needed. Several sinks do not promise which one finishes last. The runtime returns the last completed sink's output.

Use `output: ({ context }) => value` when the application needs one stable final shape. The selector is synchronous and runs after activated work finishes.

A run callback can return or await an adapter. Its success value and mapped error channel become the step's facts, rather than the adapter object. This gives the callback typed item and needs arguments before it builds an Effect program. For saved rich values, declare static step `output` so resume can parse the saved JSON without replaying the callback to discover adapter metadata.

## Provided services

`DepsOf<F>` remains the full service type seen by hooks. `RequiredDepsOf<F>` subtracts keys surely supplied by `provide`.

Only required keys of the object passed to `provide` count as supplied. An optional property cannot prove that a service exists. Extra keys and incompatible implementations fail type checking.

The provided key facts stay on the returned Wizard. Child constructors and durable hosts use the remaining-deps extractor rather than asking callers to resupply services already bound to that Wizard. Per-run options can override provided implementations.

## Child selection and retry

A mapped child flow records an `each` fact. `run.child(step, keyOrIndex)` requires a saved item key or input index for that flow. Ordinary child steps accept only the step id. Mirrors and React use the input index for mapped children, which also appears in public paths such as `['batch', '0']`.

Mapped child projections preserve input order. Summary exposure produces `readonly (ChildSummary | null)[]`; nested exposure produces the same array shape with projected child state. A `null` slot represents an item without child state yet.

`RunStepId` identifies work that `startStep` can launch. `RetryStepId` also includes mapped child flows, so `retry` can recover failed items while keeping completed item outputs. The mapped-flow fact must survive compaction for these commands and projections to stay precise.

## Limits of structural typing

TypeScript cannot distinguish two different step objects with identical structural types. A foreign object with the same facts as a local step can therefore pass the type check. Runtime reference identity still rejects it.

The same object listed under two keys also needs a runtime check. A shorthand need whose alias matches a map key can identify that producer at assembly. Other needs match by type, so identical leaves remain possible sinks rather than silently dropping a real output from the union.

Object spread follows JavaScript semantics. A later property overwrites an earlier property with the same name before the compiler sees the map. Keep module keys distinct.

Missing required wizard options can prevent TypeScript from checking the callback. The failure path keeps downstream types permissive enough to avoid a cascade while the original error remains visible.

Runtime checks also cover invalid callback results, duplicate item keys, non-array item collections, non-JSON mapped errors, and incomplete services behind trusted boundaries. Static checking does not replace validation of untrusted input.

## Recorded evidence

The original spike files were removed after their cases moved to the maintained type tests. These measurements record the earlier inference and compaction work; they are not performance guarantees for the current runtime.

| Type-check program | Types | Instantiations | Memory | Check time |
|---|---|---|---|---|
| Original id-safety spike | 17,200 | 64,060 | about 121 MB | 0.34 s |
| Original 120-step assembly | 27,936 | 146,816 | about 129 MB | 0.51 to 0.54 s |
| Separate declaration consumer | 2,767 | 7,499 | about 145 MB | 0.08 s |

Compact step facts and named binding interfaces reduced the original 120-step declaration from about 1.5 MB to 193 KB. The later assembly-validation review measured roughly 300,000 instantiations for 150 steps and 806,000 for 400 steps. Structural twin detection accounts for part of that cost.

Maintain focused type cases for accepted programs, invalid ids, inferred needs, mapped errors, provisioning, child service requirements, and diagnostic placement. The canary must prove the test setup rejects a real type error.

```sh
pnpm vitest run --project core --typecheck packages/core/tests/types --maxWorkers=1
pnpm test:canary
```

## Consequences

The public authoring path uses object configurations and one checked assembly call. Runtime records keep `{ kind, config, child? }`; phantom facts exist for inference rather than execution.

Changes to inference must preserve valid-program output types, property-level errors, invariant bindings, and runtime identity checks. A larger type graph is justified only when it catches a concrete user mistake without making common editor operations slow.
