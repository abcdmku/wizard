import type { Manifest, ManifestEdge, ManifestStep } from '@openwizard/core/inspect'

/** Expand mapped child definitions into one selectable group per discovered input index. */
export function instanceGraph(
  graph: Manifest,
  childPaths: readonly (readonly string[])[],
): Manifest {
  if (childPaths.length === 0) return graph
  const contexts = new Map<string, readonly (readonly string[])[]>([[JSON.stringify([]), [[]]]])
  const childrenByParent = new Map<string, (readonly string[])[]>()
  for (const path of childPaths) {
    const parent = JSON.stringify(path.slice(0, -1))
    const children = childrenByParent.get(parent) ?? []
    children.push(path)
    childrenByParent.set(parent, children)
  }
  const nodes: ManifestStep[] = []
  const starts: ManifestEdge[] = []
  for (const node of graph.nodes) {
    const parents = contexts.get(JSON.stringify(node.path)) ?? [node.path]
    const children: (readonly string[])[] = []
    for (const parent of parents) {
      nodes.push({ ...node, path: parent })
      if (node.child === undefined) continue
      const prefix = [...parent, node.id]
      const mapped =
        node.each === undefined ? [] : (childrenByParent.get(JSON.stringify(prefix)) ?? [])
      if (mapped.length === 0) children.push(prefix)
      else
        for (const path of mapped) {
          const index = path.at(-1)
          if (index === undefined || !/^(0|[1-9]\d*)$/.test(index)) continue
          children.push(path)
          nodes.push({
            id: index,
            kind: 'child',
            path: prefix,
            label: `item ${index}`,
            hooks: [],
            child: node.child,
          })
          starts.push({ from: null, to: index, kind: 'start', path: prefix })
        }
    }
    if (node.child !== undefined) contexts.set(JSON.stringify([...node.path, node.id]), children)
  }
  const edges = graph.edges.flatMap((edge) =>
    (contexts.get(JSON.stringify(edge.path)) ?? [edge.path]).map((path) => ({ ...edge, path })),
  )
  const warnings = graph.warnings.flatMap((warning) =>
    (contexts.get(JSON.stringify(warning.path)) ?? [warning.path]).map((path) => ({
      ...warning,
      path,
    })),
  )
  return { ...graph, nodes, edges: [...edges, ...starts], warnings }
}

/** Strip only mapped indices when matching an instance selection to its static definition. */
export function definitionPath(
  graph: Manifest,
  path: readonly string[],
): readonly string[] | undefined {
  const definition: string[] = []
  for (let position = 0; position < path.length; position++) {
    const id = path[position]
    const owner = graph.nodes.find(
      (node) =>
        node.id === id &&
        node.path.length === definition.length &&
        node.path.every((segment, offset) => segment === definition[offset]),
    )
    if (id === undefined || owner?.child === undefined) return undefined
    definition.push(id)
    if (owner.each !== undefined) {
      const index = path[++position]
      if (index === undefined || !/^(0|[1-9]\d*)$/.test(index)) return undefined
    }
  }
  return definition
}
