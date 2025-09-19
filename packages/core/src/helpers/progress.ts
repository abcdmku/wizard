import type { WizardConfig, StepStatus } from '../types';
import type { RequirementChecks } from './requirements';
import type { StateAccess } from './stateAccess';

export type ProgressApi<S extends string> = {
  progress(): { ratio: number; percent: number; label: string };
  remainingRequiredCount(): number;
  isComplete(): boolean;
  percentCompletePerStep(): Record<S, number>;
};

export type StepStatusResolver<S extends string> = (step: S) => StepStatus;

export function createProgressApi<C, S extends string, D extends Record<S, unknown>, E>(
  config: WizardConfig<C, S, D, E>,
  ordered: readonly S[],
  requirements: RequirementChecks<S>,
  isStepSatisfied: (step: S) => boolean,
  state?: StateAccess<C, S, D>
): ProgressApi<S> {
  const baseProgress = () => {
    const total = ordered.length || 1;
    const done = requirements.completed().length;

    // Check if any weights are defined (step-level or wizard-level)
    const hasStepWeights = ordered.some(step => 'weight' in (config.steps[step] || {}));
    const hasWizardWeights = config.weights && Object.keys(config.weights).length > 0;

    const ratio = (hasStepWeights || hasWizardWeights)
      ? weightedRatio(ordered, requirements.completed(), config, state?.get().context)
      : done / total;

    return {
      ratio,
      percent: Math.round(ratio * 100),
      label: `${done} / ${total}`,
    };
  };

  const remainingRequiredCount = () => {
    return ordered
      .filter((step) => requirements.isRequired(step))
      .filter((step) => !isStepSatisfied(step))
      .length;
  };

  const isComplete = () => {
    return ordered
      .filter((step) => requirements.isRequired(step))
      .every((step) => isStepSatisfied(step));
  };

  const percentCompletePerStep = () => {
    const result = {} as Record<S, number>;
    for (const step of ordered) {
      result[step] = isStepSatisfied(step) ? 100 : 0;
    }
    return result;
  };

  return {
    progress: baseProgress,
    remainingRequiredCount,
    isComplete,
    percentCompletePerStep,
  };
}

function weightedRatio<C, S extends string, D extends Record<S, unknown>, E>(
  ordered: readonly S[],
  completed: readonly S[],
  config: WizardConfig<C, S, D, E>,
  context?: C
): number {
  const completedSet = new Set(completed);
  let totalWeight = 0;
  let completedWeight = 0;
  const hasStepWeights = ordered.some(step => 'weight' in (config.steps[step] || {}));

  for (const step of ordered) {
    const stepDef = config.steps[step];
    let weight = 1; // Default weight

    // Check new step-level weight first
    if (stepDef?.weight !== undefined) {
      weight = typeof stepDef.weight === 'function' && context
        ? stepDef.weight(context)
        : typeof stepDef.weight === 'number'
        ? stepDef.weight
        : 1;
    }
    // Fallback to deprecated wizard-level weights
    else if (config.weights?.[step] !== undefined) {
      if (process.env.NODE_ENV !== 'production' && !hasStepWeights) {
        console.warn(`[Wizard] weights at wizard level is deprecated. Use step.weight instead for step '${step}'`);
      }
      weight = config.weights[step];
    }

    totalWeight += weight;
    if (completedSet.has(step)) {
      completedWeight += weight;
    }
  }

  return totalWeight > 0 ? completedWeight / totalWeight : 0;
}

