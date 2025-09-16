import type { Wizard, WizardConfig } from './types';
/**
 * Creates a deeply type-safe wizard instance
 * @template C - Global shared context type
 * @template S - Union of step IDs
 * @template D - Per-step data map
 * @template E - Event types
 */
export declare function createWizard<C, S extends string, D extends Record<S, unknown>, E = never>(config: WizardConfig<C, S, D, E>): Wizard<C, S, D, E>;
//# sourceMappingURL=wizard.d.ts.map