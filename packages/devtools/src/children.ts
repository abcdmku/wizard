import type { RunSource, SnapshotLike } from './types'

interface ChildSnapshot {
  readonly step: string
  readonly index?: number
  readonly snapshot: SnapshotLike
}

const childCache = new WeakMap<
  SnapshotLike,
  {
    readonly entries: readonly ChildSnapshot[]
    readonly byPath: ReadonlyMap<string, SnapshotLike>
  }
>()

/** Convert stored child addresses to paths only after checking the owning step and item key. */
export function snapshotChildren(snapshot: SnapshotLike): readonly ChildSnapshot[] {
  const cached = childCache.get(snapshot)
  if (cached !== undefined) return cached.entries
  const children: ChildSnapshot[] = []
  for (const [address, child] of Object.entries(snapshot.children)) {
    if (child === undefined) continue
    if (Object.hasOwn(snapshot.state.steps, address)) {
      if (snapshot.state.steps[address]?.kind === 'flow')
        children.push({ step: address, snapshot: child })
      continue
    }
    const [prefix, encodedStep, rawIndex, encodedKey, ...extra] = address.split('/')
    if (
      prefix === undefined ||
      !/^@+each$/.test(prefix) ||
      encodedStep === undefined ||
      rawIndex === undefined ||
      encodedKey === undefined ||
      extra.length !== 0 ||
      !/^(0|[1-9]\d*)$/.test(rawIndex)
    )
      continue
    const index = Number(rawIndex)
    if (!Number.isSafeInteger(index)) continue
    try {
      const step = decodeURIComponent(encodedStep)
      const record = Object.hasOwn(snapshot.state.steps, step)
        ? snapshot.state.steps[step]
        : undefined
      if (record?.kind === 'flow' && record.each?.keys[index] === decodeURIComponent(encodedKey))
        children.push({ step, index, snapshot: child })
    } catch {
      // Malformed encoded addresses cannot select a child.
    }
  }
  childCache.set(snapshot, {
    entries: children,
    byPath: new Map(
      children.map((child) => [JSON.stringify([child.step, child.index]), child.snapshot]),
    ),
  })
  return children
}

function childAt(
  snapshot: SnapshotLike,
  step: string,
  index: number | undefined,
): SnapshotLike | undefined {
  snapshotChildren(snapshot)
  return childCache.get(snapshot)?.byPath.get(JSON.stringify([step, index]))
}

/** Follow public paths. An index is consumed only when the stored owner is a mapped flow. */
export function snapshotAtPath(
  snapshot: SnapshotLike,
  path: readonly string[],
): SnapshotLike | undefined {
  let node: SnapshotLike | undefined = snapshot
  for (let position = 0; position < path.length; position++) {
    const step = path[position]
    if (step === undefined || node === undefined) return undefined
    const mapped: boolean =
      node.state.steps[step]?.kind === 'flow' && node.state.steps[step]?.each !== undefined
    const rawIndex: string | undefined = mapped ? path[++position] : undefined
    if (mapped && (rawIndex === undefined || !/^(0|[1-9]\d*)$/.test(rawIndex))) return undefined
    const index: number | undefined = rawIndex === undefined ? undefined : Number(rawIndex)
    node = childAt(node, step, index)
  }
  return node
}

/** Explain through live selected handles, including nested numeric step ids. */
export function runAtPath(
  run: RunSource,
  path: readonly string[],
): Pick<RunSource, 'explain' | 'child'> | undefined {
  let node: SnapshotLike | undefined = run.getSnapshot()
  let scope: Pick<RunSource, 'explain' | 'child'> = run
  for (let position = 0; position < path.length; position++) {
    const step = path[position]
    if (step === undefined || node === undefined) return undefined
    const mapped: boolean =
      node.state.steps[step]?.kind === 'flow' && node.state.steps[step]?.each !== undefined
    const rawIndex: string | undefined = mapped ? path[++position] : undefined
    if (mapped && (rawIndex === undefined || !/^(0|[1-9]\d*)$/.test(rawIndex))) return undefined
    const index: number | undefined = rawIndex === undefined ? undefined : Number(rawIndex)
    node = childAt(node, step, index)
    try {
      scope = index === undefined ? scope.child(step) : scope.child(step, index)
    } catch {
      return undefined
    }
  }
  return scope
}
