/**
 * Pure selectors for wizard state - tree-shakable utilities
 */

import type {
  WizardConfig,
  WizardState,
  StepStatus,
} from './types';

/**
 * Get all steps from config
 */
export const allSteps = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>
): readonly S[] => {
  return Object.keys(config.steps) as S[];
};

/**
 * Get ordered steps from config
 */
export const orderedSteps = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>
): readonly S[] => {
  if (config.order) {
    return config.order;
  }
  return allSteps(config);
};

/**
 * Check if a step is complete
 */
export const isStepComplete = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>,
  state: WizardState<C, S, D>,
  step: S
): boolean => {
  if (config.isStepComplete) {
    return config.isStepComplete({
      step,
      data: state.data,
      ctx: state.context,
    });
  }
  return state.data[step] != null;
};

/**
 * Get completed steps
 */
export const completedSteps = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>,
  state: WizardState<C, S, D>
): readonly S[] => {
  return orderedSteps(config).filter(s => isStepComplete(config, state, s));
};

/**
 * Check if a step is required
 */
export const isRequired = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>,
  state: WizardState<C, S, D>,
  step: S
): boolean => {
  if (config.isRequired) {
    return config.isRequired(step, state.context);
  }
  if (config.isOptional) {
    return !config.isOptional(step, state.context);
  }
  return true;
};

/**
 * Check if a step is optional
 */
export const isOptional = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>,
  state: WizardState<C, S, D>,
  step: S
): boolean => {
  if (config.isOptional) {
    return config.isOptional(step, state.context);
  }
  if (config.isRequired) {
    return !config.isRequired(step, state.context);
  }
  return false;
};

/**
 * Check if prerequisites are met for a step
 */
export const prerequisitesMet = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>,
  state: WizardState<C, S, D>,
  step: S
): boolean => {
  const prereqs = config.prerequisites?.[step] ?? [];
  return prereqs.every(p => isStepComplete(config, state, p));
};

/**
 * Get step status
 */
export const stepStatus = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>,
  state: WizardState<C, S, D>,
  step: S
): StepStatus => {
  // Current step
  if (state.step === step) return 'current';

  // Runtime marks
  const rt = state.runtime?.[step];
  if (rt?.status === 'terminated') return 'terminated';
  if (rt?.status === 'error') return 'error';
  if (rt?.status === 'loading') return 'loading';
  if (rt?.status === 'skipped') return 'skipped';

  // Completed
  if (isStepComplete(config, state, step)) return 'completed';

  // Unavailable (simplified - doesn't check canEnter guards)
  if (!prerequisitesMet(config, state, step)) return 'unavailable';

  // Meta status
  return isOptional(config, state, step) ? 'optional' : 'required';
};

/**
 * Calculate progress
 */
export const progress = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>,
  state: WizardState<C, S, D>
): { ratio: number; percent: number; label: string } => {
  const ordered = orderedSteps(config);
  const completed = completedSteps(config, state);
  const total = ordered.length || 1;
  const done = completed.length;

  let ratio = done / total;

  // If weights are provided, calculate weighted ratio
  if (config.weights) {
    let totalWeight = 0;
    let completedWeight = 0;
    const completedSet = new Set(completed);

    for (const step of ordered) {
      const weight = config.weights[step] ?? 1;
      totalWeight += weight;
      if (completedSet.has(step)) {
        completedWeight += weight;
      }
    }

    ratio = totalWeight > 0 ? completedWeight / totalWeight : 0;
  }

  return {
    ratio,
    percent: Math.round(ratio * 100),
    label: `${done} / ${total}`,
  };
};

/**
 * Check if wizard is complete (all required steps done)
 */
export const isComplete = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>,
  state: WizardState<C, S, D>
): boolean => {
  return orderedSteps(config)
    .filter(s => isRequired(config, state, s))
    .every(s => stepStatus(config, state, s) === 'completed');
};

/**
 * Get first incomplete step
 */
export const firstIncompleteStep = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>,
  state: WizardState<C, S, D>
): S | null => {
  for (const step of orderedSteps(config)) {
    const status = stepStatus(config, state, step);
    if (status !== 'completed' && status !== 'terminated' && status !== 'skipped') {
      return step;
    }
  }
  return null;
};

/**
 * Get remaining steps from current position
 */
export const remainingSteps = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>,
  state: WizardState<C, S, D>
): readonly S[] => {
  const ordered = orderedSteps(config);
  const currentIdx = ordered.indexOf(state.step);
  return ordered.slice(currentIdx + 1);
};

/**
 * Count remaining required steps
 */
export const remainingRequiredCount = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>,
  state: WizardState<C, S, D>
): number => {
  return orderedSteps(config)
    .filter(s => isRequired(config, state, s))
    .filter(s => stepStatus(config, state, s) !== 'completed')
    .length;
};

/**
 * Get step attempts
 */
export const stepAttempts = <C, S extends string, D extends Record<S, unknown>>(
  state: WizardState<C, S, D>,
  step: S
): number => {
  return state.runtime?.[step]?.attempts ?? 0;
};

/**
 * Get step duration
 */
export const stepDuration = <C, S extends string, D extends Record<S, unknown>>(
  state: WizardState<C, S, D>,
  step: S
): number | null => {
  const rt = state.runtime?.[step];
  if (rt?.startedAt && rt?.finishedAt) {
    return rt.finishedAt - rt.startedAt;
  }
  return null;
};