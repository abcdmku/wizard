import type { WizardTransitionEvent } from '../types';
import type { StateManager } from './stateManager';
import type { ContextManager } from './contextManager';
import type { StepLifecycle } from './stepLifecycle';
import type { HistoryManager } from './history';

export type TransitionController<S extends string, D extends Record<S, unknown>> = {
  transitionTo(targetStep: S, options?: { data?: D[S]; type?: TransitionType }): Promise<void>;
  next(options?: { data?: D[S] }): Promise<void>;
  goTo(step: S, options?: { data?: D[S] }): Promise<void>;
  back(): Promise<void>;
  getNextSteps(): S[];
};

export type TransitionType = 'next' | 'back' | 'goto';

type Dependencies<C, S extends string, D extends Record<S, unknown>, E> = {
  state: StateManager<C, S, D>;
  context: ContextManager<C, S, D>;
  history: HistoryManager<C, S, D>;
  lifecycle: StepLifecycle<S>;
  onTransition?: (event: WizardTransitionEvent<C, S, D, E>) => Promise<void> | void;
};

export function createTransitionController<C, S extends string, D extends Record<S, unknown>, E>(
  deps: Dependencies<C, S, D, E>
): TransitionController<S, D> {
  const { state, context, history, lifecycle, onTransition } = deps;

  const setTransitioning = (isTransitioning: boolean) => {
    state.update((prev) => ({
      ...prev,
      isTransitioning,
    }));
  };

  const transitionTo = async (
    targetStep: S,
    options?: { data?: D[S]; type?: TransitionType }
  ): Promise<void> => {
    const { data, type = 'goto' } = options ?? {};
    const fromStep = state.get().step;

    setTransitioning(true);

    try {
      if (data !== undefined) {
        const validation = await lifecycle.validateStepData(fromStep, data);
        if (!validation.valid) {
          state.update((prev) => ({
            ...prev,
            errors: {
              ...prev.errors,
              [fromStep]: validation.error,
            },
            isTransitioning: false,
          }));
          throw new Error(`Validation failed for step ${fromStep}`);
        }
        context.setStepData(fromStep, data);
      }

      const canExit = await lifecycle.canExitCurrentStep();
      if (!canExit) {
        setTransitioning(false);
        throw new Error(`Cannot exit step ${fromStep}`);
      }

      await lifecycle.executeBeforeExit();

      const canEnter = await lifecycle.canEnterStep(targetStep);
      if (!canEnter) {
        setTransitioning(false);
        throw new Error(`Cannot enter step ${targetStep}`);
      }

      if (type !== 'back') {
        history.push();
      }

      state.update((prev) => {
        const runtime = { ...(prev.runtime ?? {}) } as NonNullable<typeof prev.runtime>;

        if (fromStep !== targetStep) {
          runtime[fromStep] = {
            ...(runtime[fromStep] ?? {}),
            attempts: (runtime[fromStep]?.attempts ?? 0) + 1,
            finishedAt: Date.now(),
          };
        }

        runtime[targetStep] = {
          ...(runtime[targetStep] ?? {}),
          startedAt: Date.now(),
          attempts: (runtime[targetStep]?.attempts ?? 0) + 1,
        };

        return {
          ...prev,
          step: targetStep,
          isTransitioning: false,
          runtime,
        };
      });

      await lifecycle.executeLoad(targetStep);

      if (onTransition) {
        await onTransition({
          from: fromStep,
          to: targetStep,
          context: context.getContext(),
          data: state.get().data,
          type,
        });
      }
    } catch (error) {
      setTransitioning(false);
      throw error;
    }
  };

  const next = async (options?: { data?: D[S] }) => {
    const nextSteps = lifecycle.getNextSteps();
    if (nextSteps.length === 0) {
      throw new Error('No next step available');
    }
    await transitionTo(nextSteps[0]!, { data: options?.data, type: 'next' });
  };

  const goTo = async (step: S, options?: { data?: D[S] }) => {
    await transitionTo(step, { data: options?.data, type: 'goto' });
  };

  const back = async () => {
    const previous = history.pop();
    if (!previous) {
      throw new Error('No history available to go back');
    }

    const currentStep = state.get().step;

    state.update((prev) => ({
      ...prev,
      step: previous.step,
      context: previous.context,
      data: previous.data,
    }));

    await lifecycle.executeLoad(previous.step);

    if (onTransition) {
      await onTransition({
        from: currentStep,
        to: previous.step,
        context: context.getContext(),
        data: state.get().data,
        type: 'back',
      });
    }
  };

  return {
    transitionTo,
    next,
    goTo,
    back,
    getNextSteps: lifecycle.getNextSteps,
  };
}
