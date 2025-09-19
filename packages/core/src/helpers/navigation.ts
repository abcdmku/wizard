import type { StepStatus } from '../types';
import type { AvailabilityApi } from './availability';
import type { StateAccess } from './stateAccess';
import type { StepStatusResolver } from './progress';

export type NavigationApi<S extends string> = {
  remainingSteps(): readonly S[];
  firstIncompleteStep(): S | null;
  lastCompletedStep(): S | null;
  canGoNext(): boolean;
  canGoBack(): boolean;
  canGoTo(step: S): boolean;
};

export function createNavigationApi<C, S extends string, D extends Record<S, unknown>>(
  ordered: readonly S[],
  state: StateAccess<C, S, D>,
  availability: AvailabilityApi<S>,
  resolveStatus: StepStatusResolver<S>,
  isStepSatisfied: (step: S) => boolean
): NavigationApi<S> {
  const remainingSteps = (): readonly S[] => {
    const currentIndex = ordered.indexOf(state.get().step);
    return ordered.slice(currentIndex + 1);
  };

  const firstIncompleteStep = (): S | null => {
    for (const step of ordered) {
      const status = resolveStatus(step);
      if (status === 'terminated' || status === 'skipped') {
        continue;
      }
      if (isStepSatisfied(step)) {
        continue;
      }
      return step;
    }
    return null;
  };

  const lastCompletedStep = (): S | null => {
    for (let index = ordered.indexOf(state.get().step); index >= 0; index--) {
      const step = ordered[index];
      if (isStepSatisfied(step)) {
        return step;
      }
    }
    return null;
  };

  const canGoNext = () => availability.findNextAvailable() !== null;
  const canGoBack = () => state.get().history.length > 0;

  const allowedStatuses: StepStatus[] = ['current', 'completed', 'optional', 'required'];
  const canGoTo = (step: S): boolean => {
    const status = resolveStatus(step);
    if (!allowedStatuses.includes(status)) {
      return false;
    }
    return availability.canEnterSync(step);
  };

  return {
    remainingSteps,
    firstIncompleteStep,
    lastCompletedStep,
    canGoNext,
    canGoBack,
    canGoTo,
  };
}
