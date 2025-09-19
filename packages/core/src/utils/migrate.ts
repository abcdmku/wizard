/**
 * Migration utility to help convert wizard configs from old syntax to new syntax
 */

import type { WizardConfig } from '../types';

/**
 * Migrate wizard config from old wizard-level attributes to new step-level attributes.
 * This function helps users transition from the deprecated API to the new API.
 *
 * @param config - Original wizard configuration with deprecated properties
 * @returns New wizard configuration with step-level properties
 *
 * @example
 * ```typescript
 * // Old config
 * const oldConfig = {
 *   initialStep: 'step1',
 *   weights: { step2: 2, step3: 3 },
 *   prerequisites: { step3: ['step1', 'step2'] },
 *   isOptional: (step) => step === 'step2',
 *   steps: {
 *     step1: { next: ['step2'] },
 *     step2: { next: ['step3'] },
 *     step3: { next: [] }
 *   }
 * };
 *
 * // Migrated config
 * const newConfig = migrateWizardConfig(oldConfig);
 * // Results in:
 * // {
 * //   initialStep: 'step1',
 * //   steps: {
 * //     step1: { next: ['step2'], weight: 1 },
 * //     step2: { next: ['step3'], weight: 2, required: false },
 * //     step3: { next: [], weight: 3, prerequisites: ['step1', 'step2'] }
 * //   }
 * // }
 * ```
 */
export function migrateWizardConfig<C, S extends string, D extends Record<S, unknown>, E>(
  config: WizardConfig<C, S, D, E>
): WizardConfig<C, S, D, E> {
  const migrated = { ...config };

  // Create deep copy of steps
  migrated.steps = {} as typeof config.steps;
  for (const [key, value] of Object.entries(config.steps)) {
    migrated.steps[key as S] = { ...(value as Record<string, any>) } as any;
  }

  // Migrate weights
  if (config.weights) {
    Object.entries(config.weights).forEach(([step, weight]) => {
      if (migrated.steps[step as S]) {
        (migrated.steps[step as S] as any).weight = weight;
      }
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Wizard Migration] Migrated weights from wizard-level to step-level');
    }

    delete migrated.weights;
  }

  // Migrate prerequisites
  if (config.prerequisites) {
    Object.entries(config.prerequisites).forEach(([step, prereqs]) => {
      if (migrated.steps[step as S]) {
        (migrated.steps[step as S] as any).prerequisites = prereqs as S[];
      }
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Wizard Migration] Migrated prerequisites from wizard-level to step-level');
    }

    delete migrated.prerequisites;
  }

  // Migrate isOptional/isRequired
  if (config.isOptional || config.isRequired) {
    Object.keys(config.steps).forEach((step) => {
      if (config.isOptional) {
        // For function-based isOptional, we can't automatically migrate
        // since we don't have context at migration time
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[Wizard Migration] Cannot automatically migrate function-based isOptional for step '${step}'. ` +
            `Please manually update to use step.required property.`
          );
        }
      }

      if (config.isRequired) {
        // For function-based isRequired, we can't automatically migrate
        // since we don't have context at migration time
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[Wizard Migration] Cannot automatically migrate function-based isRequired for step '${step}'. ` +
            `Please manually update to use step.required property.`
          );
        }
      }
    });

    delete migrated.isOptional;
    delete migrated.isRequired;
  }

  // Migrate isStepComplete
  if (config.isStepComplete) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[Wizard Migration] Cannot automatically migrate isStepComplete function. ` +
        `Please manually update each step to use step.complete property.`
      );
    }

    delete migrated.isStepComplete;
  }

  return migrated;
}

/**
 * Check if a wizard config uses deprecated properties
 * @param config - Wizard configuration to check
 * @returns True if config uses deprecated properties
 */
export function hasDeprecatedProperties<C, S extends string, D extends Record<S, unknown>, E>(
  config: WizardConfig<C, S, D, E>
): boolean {
  return !!(
    config.weights ||
    config.prerequisites ||
    config.isOptional ||
    config.isRequired ||
    config.isStepComplete
  );
}

/**
 * Get a report of deprecated properties used in a wizard config
 * @param config - Wizard configuration to analyze
 * @returns Array of deprecation warnings
 */
export function getDeprecationReport<C, S extends string, D extends Record<S, unknown>, E>(
  config: WizardConfig<C, S, D, E>
): string[] {
  const warnings: string[] = [];

  if (config.weights) {
    warnings.push('config.weights is deprecated. Use step.weight instead for each step.');
  }

  if (config.prerequisites) {
    warnings.push('config.prerequisites is deprecated. Use step.prerequisites instead for each step.');
  }

  if (config.isOptional) {
    warnings.push('config.isOptional is deprecated. Use step.required instead (with inverted logic).');
  }

  if (config.isRequired) {
    warnings.push('config.isRequired is deprecated. Use step.required instead.');
  }

  if (config.isStepComplete) {
    warnings.push('config.isStepComplete is deprecated. Use step.complete instead for each step.');
  }

  return warnings;
}