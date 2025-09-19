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
    if (typeof next === 'function') {
      try {
        const data = state.get().data[step];
        const ctx = state.get().context;
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
    stepIndex: (step) => ordered.indexOf(step),
    currentIndex: () => ordered.indexOf(state.get().step),

    stepStatus: resolveStatus,
    isOptional: requirements.isOptional,
    isRequired: requirements.isRequired,

    availableSteps: () => availability.availableSteps(),
    unavailableSteps: () => availability.unavailableSteps(),
    refreshAvailability: () => availability.refreshAvailability(),

    completedSteps: () => requirements.completed(),
    remainingSteps: navigation.remainingSteps,
    firstIncompleteStep: navigation.firstIncompleteStep,
    lastCompletedStep: navigation.lastCompletedStep,
    remainingRequiredCount: progress.remainingRequiredCount,
    isComplete: progress.isComplete,
    progress: progress.progress,

    canGoNext: navigation.canGoNext,
    canGoBack: navigation.canGoBack,
    canGoTo: navigation.canGoTo,
    findNextAvailable: availability.findNextAvailable,
    findPrevAvailable: availability.findPrevAvailable,
    jumpToNextRequired: availability.jumpToNextRequired,

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






