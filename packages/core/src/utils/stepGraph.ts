import type { WizardConfig } from '../types';

export function computeAllSteps<C, S extends string, D extends Record<S, unknown>, E>(
  config: WizardConfig<C, S, D, E>
): readonly S[] {
  return Object.keys(config.steps) as S[];
}

export function computeOrderedSteps<C, S extends string, D extends Record<S, unknown>, E>(
  config: WizardConfig<C, S, D, E>
): readonly S[] {
  if (config.order) {
    return config.order;
  }

  if (config.prerequisites) {
    const sorted = topologicalSort(config.prerequisites);
    if (sorted) {
      const allSteps = computeAllSteps(config);
      const sortedSet = new Set(sorted);
      const remaining = allSteps.filter((step) => !sortedSet.has(step));
      return [...sorted, ...remaining];
    }
  }

  return computeAllSteps(config);
}

export function topologicalSort<S extends string>(
  prerequisites: Partial<Record<S, readonly S[]>>
): S[] | null {
  const nodes = new Set<S>();
  const edges = new Map<S, Set<S>>();

  for (const [node, deps] of Object.entries(prerequisites) as [S, readonly S[]][]) {
    nodes.add(node);
    if (!edges.has(node)) {
      edges.set(node, new Set());
    }

    for (const dep of deps || []) {
      nodes.add(dep);
      if (!edges.has(dep)) {
        edges.set(dep, new Set());
      }
      edges.get(dep)!.add(node);
    }
  }

  const inDegree = new Map<S, number>();
  for (const node of nodes) {
    inDegree.set(node, 0);
  }
  for (const [, deps] of edges) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
    }
  }

  const queue: S[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node);
    }
  }

  const result: S[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);

    for (const neighbor of edges.get(node) || []) {
      const degree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, degree);
      if (degree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (result.length !== nodes.size) {
    return null;
  }

  return result;
}
