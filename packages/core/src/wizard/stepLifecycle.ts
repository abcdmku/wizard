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
      const validator: NonNullable<typeof stepDef.validate> = stepDef.validate;
      validator(data, context.getContext());
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





