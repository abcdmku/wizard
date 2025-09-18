import { Store } from '@tanstack/store';
import type {
  WizardConfig,
  WizardState,
  WizardHelpers,
  StepStatus,
} from './types';

/**
 * Debounce utility to limit function execution frequency.
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function that returns a promise
 */
function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingPromise: Promise<Awaited<ReturnType<T>>> | null = null;

  return (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    if (pendingPromise) return pendingPromise;

    const promise = new Promise<Awaited<ReturnType<T>>>((resolve) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        const result = await fn(...args);
        pendingPromise = null;
        resolve(result);
      }, delay);
    });

    pendingPromise = promise;
    return promise;
  };
}

/**
 * Compute all steps from config.
 * Extracts all step IDs from the configuration.
 * @param config - Wizard configuration
 * @returns Array of all step IDs
 */
function computeAllSteps<C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>
): readonly S[] {
  return Object.keys(config.steps) as S[];
}

/**
 * Compute ordered steps.
 * Tries explicit order, then topological sort, then declaration order.
 * @param config - Wizard configuration
 * @returns Array of steps in determined order
 */
function computeOrderedSteps<C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>
): readonly S[] {
  // If explicit order provided, use it
  if (config.order) {
    return config.order;
  }

  // Try topological sort if prerequisites defined
  if (config.prerequisites) {
    const sorted = topologicalSort(config.prerequisites);
    if (sorted) {
      // Add any steps not in prereqs to the end
      const allSteps = computeAllSteps(config);
      const sortedSet = new Set(sorted);
      const remaining = allSteps.filter(s => !sortedSet.has(s));
      return [...sorted, ...remaining];
    }
  }

  // Fall back to declaration order
  return computeAllSteps(config);
}

/**
 * Topological sort for DAG (Directed Acyclic Graph).
 * Uses Kahn's algorithm to determine valid ordering.
 * @param prerequisites - Map of step to its prerequisites
 * @returns Sorted array of steps or null if cycles detected
 */
function topologicalSort<S extends string>(
  prerequisites: Partial<Record<S, readonly S[]>>
): S[] | null {
  const nodes = new Set<S>();
  const edges = new Map<S, Set<S>>();

  // Build graph
  for (const [node, deps] of Object.entries(prerequisites) as [S, readonly S[]][]) {
    nodes.add(node);
    if (!edges.has(node)) edges.set(node, new Set());

    for (const dep of deps || []) {
      nodes.add(dep);
      if (!edges.has(dep)) edges.set(dep, new Set());
      edges.get(dep)!.add(node);
    }
  }

  // Kahn's algorithm
  const inDegree = new Map<S, number>();
  for (const node of nodes) {
    inDegree.set(node, 0);
  }
  for (const [_, deps] of edges) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
    }
  }

  const queue: S[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node);
  }

  const result: S[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);

    for (const neighbor of edges.get(node) || []) {
      const degree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, degree);
      if (degree === 0) queue.push(neighbor);
    }
  }

  // Check for cycles
  if (result.length !== nodes.size) {
    return null;
  }

  return result;
}

/**
 * Calculate weighted progress ratio.
 * Steps with higher weights contribute more to overall progress.
 * @param ordered - Ordered list of steps
 * @param completed - List of completed steps
 * @param weights - Weight map for steps
 * @returns Progress ratio between 0 and 1
 */
function weightedRatio<S extends string>(
  ordered: readonly S[],
  completed: readonly S[],
  weights: Partial<Record<S, number>>
): number {
  const completedSet = new Set(completed);
  let totalWeight = 0;
  let completedWeight = 0;

  for (const step of ordered) {
    const weight = weights[step] ?? 1;
    totalWeight += weight;
    if (completedSet.has(step)) {
      completedWeight += weight;
    }
  }

  return totalWeight > 0 ? completedWeight / totalWeight : 0;
}

/**
 * Create helpers for wizard functionality.
 * Returns an object with extensive helper methods for wizard state management.
 * @param config - Wizard configuration
 * @param store - Wizard state store
 * @returns Object containing all helper methods
 */
export function createHelpers<
  C,
  S extends string,
  D extends Record<S, unknown>
>(
  config: WizardConfig<C, S, D>,
  store: Store<WizardState<C, S, D>>
): WizardHelpers<C, S, D> {
  const guardCache = new Map<S, boolean>();
  const all = computeAllSteps(config);
  const ordered = computeOrderedSteps(config);

  const get = () => store.state;

  const isRequired = (s: S) => {
    const ctx = get().context;
    if (config.isRequired) {
      return !!config.isRequired(s, ctx);
    }
    if (config.isOptional) {
      return !config.isOptional(s, ctx);
    }
    return true; // default to required
  };

  const isOptional = (s: S) => {
    const ctx = get().context;
    if (config.isOptional) {
      return config.isOptional(s, ctx);
    }
    if (config.isRequired) {
      return !config.isRequired(s, ctx);
    }
    return false; // default to not optional
  };

  const isStepComplete = (s: S) => {
    const state = get();
    if (config.isStepComplete) {
      return config.isStepComplete({
        step: s,
        data: state.data,
        ctx: state.context,
      });
    }
    return state.data[s] != null;
  };

  const completed = () => ordered.filter(isStepComplete);

  const prereqsMet = (s: S) => {
    const prereqs = config.prerequisites?.[s] ?? [];
    return prereqs.every(isStepComplete);
  };

  const canEnterSync = (s: S): boolean => {
    if (!prereqsMet(s)) return false;

    const stepDef = config.steps[s];
    if (!stepDef?.canEnter) return true;

    try {
      const ctx = get().context;
      const result = stepDef.canEnter({ ctx });
      if (typeof result === 'boolean') {
        guardCache.set(s, result);
        return result;
      }
      // If it's a promise, use cached value
      return guardCache.get(s) ?? false;
    } catch {
      return guardCache.get(s) ?? false;
    }
  };

  const available = () => ordered.filter(canEnterSync);

  const status = (s: S): StepStatus => {
    const st = get();

    // Current step
    if (st.step === s) return 'current';

    // Check runtime marks
    const rt = st.runtime?.[s];
    if (rt?.status === 'terminated') return 'terminated';
    if (rt?.status === 'error') return 'error';
    if (rt?.status === 'loading') return 'loading';
    if (rt?.status === 'skipped') return 'skipped';

    // Check completion
    if (isStepComplete(s)) return 'completed';

    // Check availability
    if (!prereqsMet(s) || !canEnterSync(s)) return 'unavailable';

    // Return meta status based on requirement
    return isOptional(s) ? 'optional' : 'required';
  };

  const progress = () => {
    const total = ordered.length || 1;
    const done = completed().length;
    const ratio = config.weights
      ? weightedRatio(ordered, completed(), config.weights)
      : done / total;
    return {
      ratio,
      percent: Math.round(ratio * 100),
      label: `${done} / ${total}`,
    };
  };

  const firstIncomplete = (): S | null => {
    for (const s of ordered) {
      const st = status(s);
      if (st !== 'completed' && st !== 'terminated' && st !== 'skipped') {
        return s;
      }
    }
    return null;
  };

  const findNextAvailable = (from?: S): S | null => {
    const idx = from ? ordered.indexOf(from) : ordered.indexOf(get().step);
    for (let i = Math.max(0, idx + 1); i < ordered.length; i++) {
      const s = ordered[i];
      if (canEnterSync(s)) return s;
    }
    return null;
  };

  const findPrevAvailable = (from?: S): S | null => {
    const idx = from ? ordered.indexOf(from) : ordered.indexOf(get().step);
    for (let i = idx - 1; i >= 0; i--) {
      const s = ordered[i];
      if (canEnterSync(s)) return s;
    }
    return null;
  };

  const jumpToNextRequired = (): S | null => {
    const idx = ordered.indexOf(get().step);
    for (let i = Math.max(0, idx + 1); i < ordered.length; i++) {
      const s = ordered[i];
      if (isRequired(s) && canEnterSync(s)) return s;
    }
    return null;
  };

  const refreshAvailability = (() => {
    const impl = async () => {
      const ctx = get().context;
      for (const s of ordered) {
        const stepDef = config.steps[s];
        if (stepDef?.canEnter) {
          try {
            const result = await stepDef.canEnter({ ctx });
            guardCache.set(s, !!result);
          } catch {
            guardCache.set(s, false);
          }
        } else {
          guardCache.set(s, true);
        }
      }
      // Trigger re-render by updating state
      store.setState((st) => ({ ...st }));
    };
    return debounce(impl, 50);
  })();

  const successorsOf = (s: S): readonly S[] => {
    const stepDef = config.steps[s];
    if (!stepDef) return [];

    const next = stepDef.next;
    if (typeof next === 'function') {
      // For function-based next, we can't determine statically
      // Return empty array or we could try with current data
      try {
        const data = get().data[s];
        const ctx = get().context;
        const result = next({ ctx, data: data as any });
        return Array.isArray(result) ? [...result] as readonly S[] : [result as S] as readonly S[];
      } catch {
        return [];
      }
    }

    return [...next];
  };

  return {
    allSteps: () => all,
    orderedSteps: () => ordered,
    stepCount: () => ordered.length,
    stepIndex: (s) => ordered.indexOf(s),
    currentIndex: () => ordered.indexOf(get().step),

    stepStatus: status,
    isOptional,
    isRequired,

    availableSteps: () => available(),
    unavailableSteps: () => ordered.filter((s) => !canEnterSync(s)),
    refreshAvailability,

    completedSteps: () => completed(),
    remainingSteps: () => {
      const currentIdx = ordered.indexOf(get().step);
      return ordered.slice(currentIdx + 1);
    },
    firstIncompleteStep: firstIncomplete,
    lastCompletedStep: () => {
      const currentIdx = ordered.indexOf(get().step);
      for (let i = currentIdx; i >= 0; i--) {
        const s = ordered[i];
        if (status(s) === 'completed') return s;
      }
      return null;
    },
    remainingRequiredCount: () => {
      return ordered
        .filter(isRequired)
        .filter((s) => status(s) !== 'completed')
        .length;
    },
    isComplete: () => {
      return ordered
        .filter(isRequired)
        .every((s) => status(s) === 'completed');
    },
    progress,

    canGoNext: () => !!findNextAvailable(),
    canGoBack: () => get().history.length > 0,
    canGoTo: (s) => {
      const st = status(s);
      return ['current', 'completed', 'optional', 'required'].includes(st) && canEnterSync(s);
    },
    findNextAvailable,
    findPrevAvailable,
    jumpToNextRequired,

    isReachable: (s) => prereqsMet(s),
    prerequisitesFor: (s) => config.prerequisites?.[s] ?? [],
    successorsOf,

    stepAttempts: (s) => get().runtime?.[s]?.attempts ?? 0,
    stepDuration: (s) => {
      const rt = get().runtime?.[s];
      if (rt?.startedAt && rt?.finishedAt) {
        return rt.finishedAt - rt.startedAt;
      }
      return null;
    },
    percentCompletePerStep: () => {
      const result: Record<S, number> = {} as Record<S, number>;
      for (const s of all) {
        result[s] = status(s) === 'completed' ? 100 : 0;
      }
      return result;
    },

    snapshot: () => structuredClone(get()),
  };
}