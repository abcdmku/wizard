import type { WizardConfig, StepStatus } from '../types';
import type { RequirementChecks } from './requirements';

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
  isStepSatisfied: (step: S) => boolean
): ProgressApi<S> {
  const baseProgress = () => {
    const total = ordered.length || 1;
    const done = requirements.completed().length;
    const ratio = config.weights
      ? weightedRatio(ordered, requirements.completed(), config.weights)
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

