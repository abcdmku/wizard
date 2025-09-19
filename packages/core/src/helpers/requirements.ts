import type { WizardConfig } from '../types';
import type { StateAccess } from './stateAccess';

export type RequirementChecks<S extends string> = {
  isRequired(step: S): boolean;
  isOptional(step: S): boolean;
  isStepComplete(step: S): boolean;
  completed(): readonly S[];
  prerequisitesMet(step: S): boolean;
};

export function createRequirementChecks<C, S extends string, D extends Record<S, unknown>, E>(
  config: WizardConfig<C, S, D, E>,
  state: StateAccess<C, S, D>,
  ordered: readonly S[]
): RequirementChecks<S> {
  const isRequired = (step: S): boolean => {
    const ctx = state.get().context;
    if (config.isRequired) {
      return !!config.isRequired(step, ctx);
    }
    if (config.isOptional) {
      return !config.isOptional(step, ctx);
    }
    return true;
  };

  const isOptional = (step: S): boolean => {
    const ctx = state.get().context;
    if (config.isOptional) {
      return config.isOptional(step, ctx);
    }
    if (config.isRequired) {
      return !config.isRequired(step, ctx);
    }
    return false;
  };

  const isStepComplete = (step: S): boolean => {
    const snapshot = state.get();
    if (config.isStepComplete) {
      return config.isStepComplete({
        step,
        data: snapshot.data,
        ctx: snapshot.context,
      });
    }
    return snapshot.data[step] != null;
  };

  const completed = (): readonly S[] => {
    return ordered.filter(isStepComplete);
  };

  const prerequisitesMet = (step: S): boolean => {
    const prereqs = config.prerequisites?.[step] ?? [];
    return prereqs.every(isStepComplete);
  };

  return {
    isRequired,
    isOptional,
    isStepComplete,
    completed,
    prerequisitesMet,
  };
}




