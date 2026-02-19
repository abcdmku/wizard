import { Store } from '@tanstack/store';
import type {
  WizardConfig,
  WizardState,
  WizardHelpers,
  StepStatus,
} from '../types';
import { computeAllSteps, computeOrderedSteps } from '../utils/stepGraph';
import { createStateAccess } from './stateAccess';
import { createRequirementChecks } from './requirements';
import { createAvailabilityApi } from './availability';
import { createProgressApi } from './progress';
import { createNavigationApi } from './navigation';
import { createDiagnosticsApi } from './diagnostics';

export function createHelpers<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = unknown
>(
  config: WizardConfig<C, S, D, E>,
  store: Store<WizardState<C, S, D>>
): WizardHelpers<C, S, D> {
  const guardCache = new Map<S, boolean>();
  const all = computeAllSteps(config);
  const ordered = computeOrderedSteps(config);
  const state = createStateAccess(store);

  const requirements = createRequirementChecks(config, state, ordered);
  const availability = createAvailabilityApi(config, state, ordered, requirements, guardCache);
  const isStepSatisfied = (step: S, snapshot: WizardState<C, S, D> = state.get()): boolean => {
    const runtimeStatus = snapshot.runtime?.[step]?.status;
    if (runtimeStatus === 'terminated' || runtimeStatus === 'skipped') {
      return true;
    }
    if (runtimeStatus === 'error' || runtimeStatus === 'loading') {
      return false;
    }
    return requirements.isStepComplete(step);
  };

  const resolveStatus = (step: S): StepStatus => {
    const snapshot = state.get();

    if (snapshot.step === step) {
      return 'current';
    }

    const runtimeStatus = snapshot.runtime?.[step]?.status;
    if (runtimeStatus) {
      return runtimeStatus;
    }

    if (requirements.isStepComplete(step)) {
      return 'completed';
    }

    if (!requirements.prerequisitesMet(step) || !availability.canEnterSync(step)) {
      return 'unavailable';
    }

    return requirements.isOptional(step) ? 'optional' : 'required';
  };

  const progress = createProgressApi(config, ordered, requirements, (step: S) => isStepSatisfied(step), state);
  const navigation = createNavigationApi(ordered, state, availability, resolveStatus, (step: S) => isStepSatisfied(step));
  const diagnostics = createDiagnosticsApi(state);

  const successorsOf = (step: S): readonly S[] => {
    const stepDef = config.steps[step];
    if (!stepDef) {
      return [];
    }

    const next = stepDef.next;
    if (next == null) {
      return [];
    }
    if (typeof next === 'function') {
      try {
        const snapshot = state.get();
        const args = {
          step,
          context: snapshot.context,
          data: snapshot.data[step],
          updateContext: () => {},
          setStepData: () => {},
          emit: () => {},
        };
        const result = next(args as any);
        return Array.isArray(result) ? [...result] as readonly S[] : [result as S] as readonly S[];
      } catch {
        return [];
      }
    }

    if (next === 'any') {
      return [];
    }

    return [...next];
  };

  return {
    // Step name helpers
    allStepNames: () => all,
    orderedStepNames: () => ordered,
    availableStepNames: () => availability.availableSteps(),
    unavailableStepNames: () => availability.unavailableSteps(),
    completedStepNames: () => requirements.completed(),
    remainingStepNames: () => navigation.remainingSteps(),

    // Step object helpers - return empty/null with type assertions (will be overridden by wizard)
    allSteps: () => [] as any,
    orderedSteps: () => [] as any,
    availableSteps: () => [] as any,
    unavailableSteps: () => [] as any,
    completedSteps: () => [] as any,
    remainingSteps: () => [] as any,

    stepCount: () => ordered.length,
    stepIndex: (step) => ordered.indexOf(step),
    currentIndex: () => ordered.indexOf(state.get().step),

    stepStatus: resolveStatus,
    isOptional: requirements.isOptional,
    isRequired: requirements.isRequired,

    refreshAvailability: () => availability.refreshAvailability(),

    firstIncompleteStep: () => null as any,
    firstIncompleteStepName: navigation.firstIncompleteStep,
    lastCompletedStep: () => null as any,
    lastCompletedStepName: navigation.lastCompletedStep,

    remainingRequiredCount: progress.remainingRequiredCount,
    isComplete: progress.isComplete,
    progress: progress.progress,

    canGoNext: navigation.canGoNext,
    canGoBack: navigation.canGoBack,
    canGoTo: navigation.canGoTo,
    findNextAvailable: () => null as any,
    findNextAvailableName: availability.findNextAvailable,
    findPrevAvailable: () => null as any,
    findPrevAvailableName: availability.findPrevAvailable,
    jumpToNextRequired: () => null as any,
    jumpToNextRequiredName: availability.jumpToNextRequired,

    isReachable: (step) => requirements.prerequisitesMet(step),
    prerequisitesFor: (step) => {
      const stepDef = config.steps[step];
      // Check new step-level prerequisites first
      if (stepDef?.prerequisites) {
        return stepDef.prerequisites;
      }
      // Fallback to deprecated wizard-level
      return config.prerequisites?.[step] ?? [];
    },
    successorsOf,

    stepAttempts: diagnostics.stepAttempts,
    stepDuration: diagnostics.stepDuration,
    percentCompletePerStep: progress.percentCompletePerStep,

    snapshot: diagnostics.snapshot,
  };
}






