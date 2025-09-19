import type { WizardConfig, WizardState } from '../types';
import { debounce } from '../utils/async';
import type { StateAccess } from './stateAccess';
import type { RequirementChecks } from './requirements';

export type AvailabilityApi<S extends string> = {
  canEnterSync(step: S): boolean;
  availableSteps(): readonly S[];
  unavailableSteps(): readonly S[];
  refreshAvailability(): Promise<void>;
  findNextAvailable(from?: S): S | null;
  findPrevAvailable(from?: S): S | null;
  jumpToNextRequired(): S | null;
};

export function createAvailabilityApi<C, S extends string, D extends Record<S, unknown>, E>(
  config: WizardConfig<C, S, D, E>,
  state: StateAccess<C, S, D>,
  ordered: readonly S[],
  requirements: RequirementChecks<S>,
  guardCache: Map<S, boolean>
): AvailabilityApi<S> {
  const isStepSatisfied = (step: S, snapshot: WizardState<C, S, D>): boolean => {
    const runtimeStatus = snapshot.runtime?.[step]?.status;
    if (runtimeStatus === 'terminated' || runtimeStatus === 'skipped') {
      return true;
    }
    if (runtimeStatus === 'error' || runtimeStatus === 'loading') {
      return false;
    }
    if (snapshot.step === step) {
      return true;
    }
    return requirements.isStepComplete(step);
  };

  const hasBlockingPredecessor = (step: S, snapshot: WizardState<C, S, D>): boolean => {
    const stepIndex = ordered.indexOf(step);
    if (stepIndex <= 0) {
      return false;
    }

    for (let index = 0; index < stepIndex; index++) {
      const candidate = ordered[index];
      if (!requirements.isRequired(candidate)) {
        continue;
      }
      if (!isStepSatisfied(candidate, snapshot)) {
        return true;
      }
    }

    return false;
  };

  const canEnterSync = (step: S): boolean => {
    const snapshot = state.get();

    if (hasBlockingPredecessor(step, snapshot)) {
      return false;
    }

    if (!requirements.prerequisitesMet(step)) {
      return false;
    }

    const stepDef = config.steps[step];
    if (!stepDef?.canEnter) {
      return true;
    }

    try {
      const result = stepDef.canEnter({ ctx: snapshot.context });
      if (typeof result === 'boolean') {
        guardCache.set(step, result);
        return result;
      }
      return guardCache.get(step) ?? false;
    } catch {
      return guardCache.get(step) ?? false;
    }
  };

  const availableSteps = (): readonly S[] => ordered.filter(canEnterSync);
  const unavailableSteps = (): readonly S[] => ordered.filter((step) => !canEnterSync(step));

  const refreshAvailability = debounce(async () => {
    const snapshot = state.get();
    for (const step of ordered) {
      const stepDef = config.steps[step];
      if (!stepDef?.canEnter) {
        guardCache.set(step, !hasBlockingPredecessor(step, snapshot));
        continue;
      }

      try {
        const result = await stepDef.canEnter({ ctx: snapshot.context });
        guardCache.set(step, !!result);
      } catch {
        guardCache.set(step, false);
      }
    }

    state.trigger();
  }, 50);

  const findNextAvailable = (from?: S): S | null => {
    const current = from ?? state.get().step;
    const startIdx = Math.max(ordered.indexOf(current) + 1, 0);
    for (let index = startIdx; index < ordered.length; index++) {
      const step = ordered[index];
      if (canEnterSync(step)) {
        return step;
      }
    }
    return null;
  };

  const findPrevAvailable = (from?: S): S | null => {
    const current = from ?? state.get().step;
    const startIdx = ordered.indexOf(current) - 1;
    for (let index = startIdx; index >= 0; index--) {
      const step = ordered[index];
      if (canEnterSync(step)) {
        return step;
      }
    }
    return null;
  };

  const jumpToNextRequired = (): S | null => {
    const currentIndex = ordered.indexOf(state.get().step);
    for (let index = Math.max(0, currentIndex + 1); index < ordered.length; index++) {
      const step = ordered[index];
      if (requirements.isRequired(step) && canEnterSync(step)) {
        return step;
      }
    }
    return null;
  };

  return {
    canEnterSync,
    availableSteps,
    unavailableSteps,
    refreshAvailability,
    findNextAvailable,
    findPrevAvailable,
    jumpToNextRequired,
  };
}


