/**
 * Pure selectors for wizard state - tree-shakable utilities.
 * These functions can be imported individually for optimal bundle size.
 */

import type {
  WizardConfig,
  WizardState,
  StepStatus,
} from './types';

/**
 * Get all steps from config.
 * @param config - Wizard configuration
 * @returns Array of all step IDs
 */
export const allSteps = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>
): readonly S[] => {
  return Object.keys(config.steps) as S[];
};

/**
 * Get ordered steps from config.
 * Uses explicit order if provided, otherwise declaration order.
 * @param config - Wizard configuration
 * @returns Array of ordered step IDs
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
 * Check if a step is complete.
 * Uses custom completion check if provided, otherwise checks for data presence.
 * @param config - Wizard configuration
 * @param state - Current wizard state
 * @param step - Step ID to check
 * @returns True if step is complete
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
 * Get completed steps.
 * @param config - Wizard configuration
 * @param state - Current wizard state
 * @returns Array of completed step IDs
 */
export const completedSteps = <C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D>,
  state: WizardState<C, S, D>
): readonly S[] => {
  return orderedSteps(config).filter(s => isStepComplete(config, state, s));
};

/**
 * Check if a step is required.
 * @param config - Wizard configuration
 * @param state - Current wizard state
 * @param step - Step ID to check
 * @returns True if step is required for completion
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
 * Check if a step is optional.
 * @param config - Wizard configuration
 * @param state - Current wizard state
 * @param step - Step ID to check
 * @returns True if step can be skipped
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
 * Check if prerequisites are met for a step.
 * @param config - Wizard configuration
 * @param state - Current wizard state
 * @param step - Step ID to check
 * @returns True if all prerequisites are satisfied
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
 * Get step status.
 * Determines current status based on state, runtime marks, and completion.
 * @param config - Wizard configuration
 * @param state - Current wizard state
 * @param step - Step ID to check
 * @returns Current status of the step
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
 * Calculate progress.
 * Supports both linear and weighted progress calculation.
 * @param config - Wizard configuration
 * @param state - Current wizard state
 * @returns Progress metrics (ratio, percent, label)
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
 * Check if wizard is complete.
 * Returns true when all required steps are completed.
 * @param config - Wizard configuration
 * @param state - Current wizard state
 * @returns True if wizard is complete
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
 * Get first incomplete step.
 * Finds the first step that hasn't been completed, skipped, or terminated.
 * @param config - Wizard configuration
 * @param state - Current wizard state
 * @returns Step ID or null if all complete
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
 * Get remaining steps from current position.
 * @param config - Wizard configuration
 * @param state - Current wizard state
 * @returns Array of steps after current
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
 * Count remaining required steps.
 * @param config - Wizard configuration
 * @param state - Current wizard state
 * @returns Number of required steps not yet completed
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
 * Get step attempts.
 * @param state - Current wizard state
 * @param step - Step ID to check
 * @returns Number of times step has been attempted
 */
export const stepAttempts = <C, S extends string, D extends Record<S, unknown>>(
  state: WizardState<C, S, D>,
  step: S
): number => {
  return state.runtime?.[step]?.attempts ?? 0;
};

/**
 * Get step duration.
 * @param state - Current wizard state
 * @param step - Step ID to check
 * @returns Duration in milliseconds or null if not completed
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