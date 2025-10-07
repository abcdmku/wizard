import type { WizardGraph, WizardNode, WizardEdge, StepInfo, StepsToGraphProbe } from './types';

export type AnyStepsRecord = Record<string, {
  next?: readonly string[] | "any" | ((...args: any[]) => string | readonly string[] | "any");
  meta?: { label?: string } & Record<string, any>;
  prerequisites?: readonly string[];
} & Record<string, any>>;

export function stepsToGraph(steps: AnyStepsRecord, opts?: { probes?: StepsToGraphProbe[] }): WizardGraph {
  const nodes: WizardNode[] = [];
  const edges: WizardEdge[] = [];
  const probes = opts?.probes ?? [{}];

  for (const stepId of Object.keys(steps)) {
    const def = steps[stepId] as AnyStepsRecord[string];
    const info: StepInfo = {
      id: stepId,
      label: def?.meta?.label ? (typeof def.meta.label === 'function' ? stepId : (def.meta.label as string)) : stepId,
      description: typeof def?.meta?.description === 'string' ? def.meta.description : undefined,
      required: typeof def?.required === 'boolean' ? def.required : undefined,
      hidden: typeof def?.meta?.hidden === 'boolean' ? def.meta.hidden : undefined,
      tags: Array.isArray(def?.meta?.tags) ? [...(def.meta.tags as string[])] : undefined,
      component: !!(def as any)?.component,
      has: {
        validate: typeof (def as any)?.validate === 'function',
        beforeEnter: typeof (def as any)?.beforeEnter === 'function',
        beforeExit: typeof (def as any)?.beforeExit === 'function',
        canEnter: typeof (def as any)?.canEnter !== 'undefined',
        canExit: typeof (def as any)?.canExit !== 'undefined',
        complete: typeof (def as any)?.complete !== 'undefined',
        dynamicNext: typeof def?.next === 'function',
      },
      next: Array.isArray(def?.next) ? [...(def.next as string[])] : undefined,
      prerequisites: Array.isArray(def?.prerequisites) ? [...(def.prerequisites as string[])] : undefined,
    };

    nodes.push({
      id: stepId,
      label: info.label,
      kind: 'step',
      meta: { info },
    });

    const next = def?.next as AnyStepsRecord[string]['next'];
    const targets = new Set<string>();
    let isAnyNext = false;

    if (next === "any") {
      isAnyNext = true;
    } else if (Array.isArray(next)) {
      for (const target of next as string[]) targets.add(target);
    } else if (typeof next === 'function') {
      for (const probe of probes) {
        try {
          const result = (next as any)({
            step: stepId,
            context: probe.context ?? {},
            data: probe.dataByStep?.[stepId],
            updateContext: () => {},
            setStepData: () => {},
            emit: () => {},
            getAllStepNames: () => Object.keys(steps),
          });
          if (result === "any") {
            isAnyNext = true;
          } else {
            const out = Array.isArray(result) ? result : result ? [result] : [];
            for (const t of out) if (typeof t === 'string') targets.add(t);
          }
        } catch {
          // ignore dynamic evaluation errors; we only best-effort discover edges
        }
      }
    }

    // Store the "any" flag in the node meta
    if (isAnyNext) {
      (info as any).nextIsAny = true;
    }

    // Create edges
    if (isAnyNext) {
      // Create edges to all other steps with special "any-transition" kind
      for (const targetId of Object.keys(steps)) {
        if (targetId !== stepId) {
          edges.push({
            id: `${stepId}__any__${targetId}`,
            source: stepId,
            target: targetId,
            kind: 'any-transition',
            meta: { isAnyEdge: true }
          });
        }
      }
    } else {
      for (const target of targets) {
        edges.push({ id: `${stepId}__to__${target}`, source: stepId, target, kind: 'transition' });
      }
    }
  }

  // Step-level prerequisites (optional)
  for (const stepId of Object.keys(steps)) {
    const def = steps[stepId] as AnyStepsRecord[string];
    const prereqs = def?.prerequisites as string[] | undefined;
    if (Array.isArray(prereqs)) {
      for (const p of prereqs) {
        edges.push({ id: `${p}__prereq__${stepId}`,
          source: p, target: stepId, kind: 'prerequisite', label: 'prereq' });
      }
    }
  }

  // Deduplicate edges
  const dedupKey = (e: WizardEdge) => `${e.kind}|${e.source}|${e.target}|${e.id}`;
  const seen = new Set<string>();
  const uniqueEdges: WizardEdge[] = [];
  for (const e of edges) {
    const k = dedupKey(e);
    if (!seen.has(k)) { seen.add(k); uniqueEdges.push(e); }
  }

  return { nodes, edges: uniqueEdges };
}

// Back-compat alias for callers thinking in terms of a Config-like API
export function configToGraph(config: { steps: AnyStepsRecord }, opts?: { probes?: StepsToGraphProbe[] }): WizardGraph {
  return stepsToGraph(config.steps, opts);
}

export function analyzeSteps(steps: AnyStepsRecord): Record<string, StepInfo> {
  const graph = stepsToGraph(steps);
  const map: Record<string, StepInfo> = {};
  for (const n of graph.nodes) {
    map[n.id] = (n.meta?.info ?? { id: n.id }) as StepInfo;
  }
  return map;
}
