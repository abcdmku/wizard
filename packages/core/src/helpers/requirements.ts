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
    const stepDef = config.steps[step];

    // Check new step-level property first
    if (stepDef && 'required' in stepDef) {
      const required = stepDef.required;
      if (typeof required === 'function') {
        return required(ctx);
      }
      return required !== false; // Default true for boolean
    }

    // Fallback to deprecated wizard-level (with warning in dev)
    if (config.isRequired) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[Wizard] isRequired at wizard level is deprecated. Use step.required instead for step '${step}'`);
      }
      return !!config.isRequired(step, ctx);
    }
    if (config.isOptional) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[Wizard] isOptional at wizard level is deprecated. Use step.required instead for step '${step}'`);
      }
      return !config.isOptional(step, ctx);
    }
    return true; // Default: required
  };

  const isOptional = (step: S): boolean => {
    // Use isRequired and invert the logic
    return !isRequired(step);
  };

  const isStepComplete = (step: S): boolean => {
    const snapshot = state.get();
    const stepDef = config.steps[step];
    const stepData = snapshot.data[step];

    // Check new step-level property
    if (stepDef && 'complete' in stepDef) {
      if (typeof stepDef.complete === 'boolean') {
        return stepDef.complete;
      }
      if (typeof stepDef.complete === 'function') {
        return stepDef.complete(stepData, snapshot.context);
      }
    }

    // Fallback to deprecated wizard-level
    if (config.isStepComplete) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[Wizard] isStepComplete at wizard level is deprecated. Use step.complete instead for step '${step}'`);
      }
      return config.isStepComplete({
        step,
        data: snapshot.data,
        ctx: snapshot.context,
      });
    }

    // Default: check if data exists
    return stepData != null;
  };

  const completed = (): readonly S[] => {
    return ordered.filter(isStepComplete);
  };

  const prerequisitesMet = (step: S): boolean => {
    const stepDef = config.steps[step];

    // Check new step-level prerequisites
    if (stepDef?.prerequisites) {
      return stepDef.prerequisites.every(isStepComplete);
    }

    // Fallback to deprecated wizard-level
    const prereqs = config.prerequisites?.[step];
    if (prereqs) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[Wizard] prerequisites at wizard level is deprecated. Use step.prerequisites instead for step '${step}'`);
      }
      return prereqs.every(isStepComplete);
    }

    return true; // No prerequisites
  };

  return {
    isRequired,
    isOptional,
    isStepComplete,
    completed,
    prerequisitesMet,
  };
}




