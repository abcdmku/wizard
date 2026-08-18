# @openwizard/react

React binding for [OpenWizard](../core/README.md). `bindReact<typeof flowOrProjection>()` gives you a typed `Provider` plus hooks, and they work over either a live `Wizard` in the same process or a `Mirror`, which is the client's replica of a server-side wizard fed through a projection.

```tsx
import { bindReact } from '@openwizard/react'
import { createMirror } from '@openwizard/core'
import type { checkoutClient } from './flows/checkout' // type-only: no server code in the bundle

const ow = bindReact<typeof checkoutClient>()
const mirror = createMirror<typeof checkoutClient>({ transport })

function App() {
  return (
    <ow.Provider source={mirror} fallback={<p>Connecting...</p>}>
      <Shipping />
    </ow.Provider>
  )
}

function Shipping() {
  const { status, input, issues, setInput, next } = ow.useStep('shipping') // 'typo' is a compile error
  return (
    <form onSubmit={(e) => { e.preventDefault(); void next() }}>
      <input value={input?.address ?? ''} onChange={(e) => void setInput({ address: e.target.value })} />
      {issues?.map((i) => <p key={i.message}>{i.message}</p>)}
      <button disabled={status !== 'active'}>Continue</button>
    </form>
  )
}
```

`T` is either a flow or a projection. With a flow, `Provider` takes a `Wizard<F>` and the hooks read `Snapshot<F>['state']`; with a projection it takes a `Mirror<P>` and they read the projected `ClientState`. You pass the instance through `Provider` the way tRPC does, so the type comes from a type-only import and no server code lands in the bundle.

The hooks sit on `useSyncExternalStore`, and snapshot identities are stable per commit or frame, so `useStep(id)` and `useSelector(select, isEqual?)` only re-render when their own slice changes. `useActions()` hands back one memoised object per source with the whole command sugar on it.

| Hook | What you get |
|---|---|
| `useStep(id)` | the typed step record, with `next` / `back` on every step and `go` / `setInput` / `resetInput` on views |
| `useSelector(select, isEqual?)` | any slice you map out of the state |
| `useActions()` | `start`, `next`, `back`, `go`, `setInput`, `resetInput`, `send(event, payload, { correlationId? })`, `run`, `retry`, `cancel`, `runReady`, `compensate`, `reset`, `skip`, `invalidate`, `dispatch` |
| `useChild(step)` | hooks bound to a nested flow, see below |

`Provider`'s `fallback` renders until the source actually has state, which matters for a Mirror before its first frame.

### Nested flows: `useChild(step)`

Over a Mirror the projection has to expose the flow step with a nested spec, like `steps: { fulfil: { child: { steps: { pick: { input: true } } } } }`, so the child's projected state rides along in `steps.fulfil.child`. Over a Wizard it reads the child snapshot at `getSnapshot().children.fulfil` instead. `ow.useChild('fulfil')` then returns a `ChildBinding` typed by the child flow, with `useSnapshot()` for the child slice, `useStep(id)` scoped to the child, `useActions()` for the child's commands, and `useChild(step)` again for a grandchild. Only a step exposed with a full nested spec compiles here, and bindings are memoised per path, so writing `ow.useChild('fulfil').useStep('pick')` inline is fine.

`useSnapshot()` is `null` until the flow step is entered, and the child's `useStep` throws while there is no child state, so guard on `useSnapshot() !== null` before rendering it. Every child command travels as `{ type: 'child', path, command }` through the source's `dispatch`.

```tsx
function Fulfilment() {
  const child = ow.useChild('fulfil')
  const snap = child.useSnapshot()
  if (snap === null) return <p>Not started</p>
  return <p>Child at {snap.current ?? 'none'} <Pick /></p>
}
function Pick() {
  const { status, input, setInput, next } = ow.useChild('fulfil').useStep('pick') // typed by the CHILD flow
  return <input value={input?.warehouse ?? ''} onChange={(e) => void setInput({ warehouse: e.target.value })} onBlur={() => void next()} disabled={status !== 'active'} />
}
```

### Server rendering

Pass whatever state the server rendered with as `Provider`'s `serverSnapshot`. Over a Mirror that's a `ProjectionOutput<typeof projection>`, usually `wizard.project(projection)` serialized into the page; over a Wizard it's `Snapshot<F>['state']`. It gets captured once and used as `useSyncExternalStore`'s server snapshot both on the server and during hydration, so the hydrated tree matches the server HTML even if the live source already moved on, and React re-renders with the live state right after. Leave it out and the hooks read the live source on the server too, where a Mirror with no frame yet just renders `fallback`.

```tsx
// server
const html = renderToString(<ow.Provider source={mirror} serverSnapshot={state}><Checkout /></ow.Provider>)
// client
hydrateRoot(root, <ow.Provider source={mirror} serverSnapshot={window.__STATE__}><Checkout /></ow.Provider>)
```

Peer dependencies: `react ^18 || ^19`, `@openwizard/core` (same minor).

## Exports

<!-- exports:start -->

<!-- generated by scripts/gen-export-tables.mjs — do not edit by hand -->

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Actions` | interface | The command methods of the source (`useActions()`) — the same sugar as `Wizard` / `Mirror`, | [src](../../packages/react/src/types.ts#L92) |
| `bindReact` | function | Create a typed React binding for a flow or a projection. The type parameter is the only | [src](../../packages/react/src/bind-react.tsx#L59) |
| `BindTarget` | type | What `bindReact<T>()` accepts: a flow (the source is a `Wizard`) or a projection (the source | [src](../../packages/react/src/types.ts#L40) |
| `ChildBinding` | interface | What `useChild(step)` returns: hooks bound to the child slice of the state (`S`), typed by the | [src](../../packages/react/src/types.ts#L263) |
| `ChildBindingId` | type | Ids of the flow steps whose child state the binding can read with `useChild(step)`: over a | [src](../../packages/react/src/types.ts#L220) |
| `ChildStateOf` | type | The child slice `useChild(step)` reads: the projected child `ClientState` over a projection, | [src](../../packages/react/src/types.ts#L229) |
| `ChildStepHelpers` | type | Helpers `useChild(step).useStep(id)` binds to a child step: the scoped `MirrorChild` sugar of | [src](../../packages/react/src/types.ts#L241) |
| `CurrentOf` | type | What `useCurrent()` returns: the record of the current view step, or `null`. | [src](../../packages/react/src/types.ts#L174) |
| `ExposedChildId` | type | The steps of flow `F` whose record in the projected slice `S` carries a nested child state | [src](../../packages/react/src/types.ts#L210) |
| `FlowOf` | type | The flow behind a bind target (the projection's flow, or the flow itself). | [src](../../packages/react/src/types.ts#L46) |
| `NavResultOf` | type | Result of the navigation actions: `NavResult` from a Wizard, the ack's `CommandResult` from a Mirror. | [src](../../packages/react/src/types.ts#L77) |
| `ProviderProps` | interface | `Provider` props: the `source` (`Wizard` or `Mirror`), an optional `fallback` rendered until | [src](../../packages/react/src/types.ts#L191) |
| `ReactBinding` | interface | What `bindReact<T>()` returns: a `Provider` plus hooks typed by `T`. Every hook must be used | [src](../../packages/react/src/types.ts#L292) |
| `SendResultOf` | type | Result of the `send` action: `SendResult` from a Wizard, the ack's `CommandResult` from a Mirror. | [src](../../packages/react/src/types.ts#L83) |
| `SourceOf` | type | The live object a binding's `Provider` takes: `Wizard<F>` for a flow, `Mirror<P>` for a projection. | [src](../../packages/react/src/types.ts#L56) |
| `StateOf` | type | The state the hooks read: `Snapshot<F>['state']` over a Wizard, `ProjectionOutput<P>` | [src](../../packages/react/src/types.ts#L67) |
| `StepHelpers` | type | Helpers `useStep(id)` binds to the step: `next`/`back` (flow-level navigation) for every step; | [src](../../packages/react/src/types.ts#L151) |
| `StepRecordIn` | type | The record of step `K` of a state slice `S` (a projected `ClientState` or a wizard state): | [src](../../packages/react/src/types.ts#L130) |
| `StepRecordOf` | type | The record of step `K` as the hooks see it (`StepState` over a Wizard, the projected | [src](../../packages/react/src/types.ts#L141) |
| `UseStepResult` | type | What `useStep(id)` returns: the typed step record with the bound helpers spread in | [src](../../packages/react/src/types.ts#L167) |

<!-- exports:end -->
