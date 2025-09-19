import type { WizardConfig } from '../types';
import type { StateManager } from './stateManager';
import type { ContextManager } from './contextManager';

export type StepLifecycle<S extends string> = {
  validateStepData(step: S, data: unknown): Promise<{ valid: boolean; error?: unknown }>;
  canEnterStep(step: S): Promise<boolean>;
  canExitCurrentStep(): Promise<boolean>;
  executeBeforeExit(): Promise<void>;
  executeLoad(step: S): Promise<void>;
  getNextSteps(): S[];
};

export function createStepLifecycle<C, S extends string, D extends Record<S, unknown>, E>(
  config: WizardConfig<C, S, D, E>,
  state: StateManager<C, S, D>,
  context: ContextManager<C, S, D>,
  emit: (event: E) => void
): StepLifecycle<S> {
  const validateStepData = async (
    step: S,
    data: unknown
  ): Promise<{ valid: boolean; error?: unknown }> => {
    const stepDef = config.steps[step];
    if (!stepDef.validate) {
      return { valid: true };
    }

    try {
      const validator = stepDef.validate;

      // Support different validator patterns
      if (typeof validator === 'function') {
        // Check if it's a Zod-like parse function or a traditional validator
        const validatorFunc = validator as any;

        // If the function has a length of 1, it's likely a Zod parse or similar
        // Otherwise, it expects context as second parameter
        if (validatorFunc.length <= 1) {
          // Zod-style parse function or type guard without context
          const result = validatorFunc(data);
          // If it returns a boolean (type guard), check it
          if (typeof result === 'boolean') {
            return result ? { valid: true } : { valid: false, error: new Error('Validation failed') };
          }
          // Otherwise assume it returns validated data (like Zod parse)
          return { valid: true };
        } else {
          // Traditional validator with context
          validatorFunc(data, context.getContext());
          return { valid: true };
        }
      } else if (validator && typeof validator === 'object') {
        // Handle objects with parse method (Zod schemas)
        if ('parse' in validator && typeof (validator as any).parse === 'function') {
          (validator as any).parse(data);
          return { valid: true };
        } else if ('safeParse' in validator && typeof (validator as any).safeParse === 'function') {
          const result = (validator as any).safeParse(data);
          if (result.success) {
            return { valid: true };
          } else {
            return { valid: false, error: result.error };
          }
        }
      }

      // Fallback to calling validator as-is
      (validator as any)(data, context.getContext());
      return { valid: true };
    } catch (error) {
      return { valid: false, error };
    }
  };

  const canEnterStep = async (step: S) => {
    const stepDef = config.steps[step];
    if (!stepDef?.canEnter) {
      return true;
    }
    const result = await stepDef.canEnter({ ctx: context.getContext() });
    return !!result;
  };

  const canExitCurrentStep = async () => {
    const snapshot = state.get();
    const stepDef = config.steps[snapshot.step];
    if (!stepDef?.canExit) {
      return true;
    }
    const data = snapshot.data[snapshot.step] || ({} as D[S]);
    const result = await stepDef.canExit({
      ctx: context.getContext(),
      data: data as Readonly<D[S]>,
    });
    return !!result;
  };

  const executeBeforeExit = async () => {
    const snapshot = state.get();
    const stepDef = config.steps[snapshot.step];
    if (!stepDef?.beforeExit) {
      return;
    }
    const data = snapshot.data[snapshot.step] || ({} as D[S]);
    await stepDef.beforeExit({
      ctx: context.getContext(),
      data: data as Readonly<D[S]>,
      updateContext: context.updateContext,
      emit,
    });
  };

  const executeLoad = async (step: S) => {
    const stepDef = config.steps[step];
    if (!stepDef?.load) {
      return;
    }

    state.update((prev) => ({
      ...prev,
      isLoading: true,
    }));

    try {
      await stepDef.load({
        ctx: context.getContext(),
        setStepData: (data) => context.setStepData(step, data),
        updateContext: context.updateContext,
      });
    } finally {
      state.update((prev) => ({
        ...prev,
        isLoading: false,
      }));
    }
  };

  const getNextSteps = (): S[] => {
    const snapshot = state.get();
    const stepDef = config.steps[snapshot.step];
    const data = snapshot.data[snapshot.step] || ({} as D[S]);

    if (typeof stepDef.next === 'function') {
      const result = stepDef.next({
        ctx: context.getContext(),
        data: data as Readonly<D[S]>,
      });
      return Array.isArray(result) ? [...result] as S[] : [result as S];
    }

    return [...stepDef.next];
  };

  return {
    validateStepData,
    canEnterStep,
    canExitCurrentStep,
    executeBeforeExit,
    executeLoad,
    getNextSteps,
  };
}





