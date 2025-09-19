import type { StateManager } from './stateManager';

export type ContextManager<C, S extends string, D extends Record<S, unknown>> = {
  cloneContext(ctx: C): C;
  getContext(): Readonly<C>;
  getCurrent(): {
    step: S;
    data: Readonly<D[S]> | undefined;
    ctx: Readonly<C>;
  };
  updateContext(updater: (ctx: C) => void): void;
  setStepData(step: S, data: D[S]): void;
};

export function createContextManager<C, S extends string, D extends Record<S, unknown>>(
  state: StateManager<C, S, D>
): ContextManager<C, S, D> {
  const cloneContext = (ctx: C): C => structuredClone(ctx);

  const updateContext = (updater: (ctx: C) => void) => {
    state.update((prev) => {
      const draft = cloneContext(prev.context);
      updater(draft);
      return {
        ...prev,
        context: draft,
      };
    });
  };

  const setStepData = (step: S, data: D[S]) => {
    state.update((prev) => {
      const nextData = {
        ...prev.data,
        [step]: data,
      };
      const nextErrors = prev.errors[step]
        ? { ...prev.errors, [step]: undefined }
        : prev.errors;
      return {
        ...prev,
        data: nextData,
        errors: nextErrors,
      };
    });
  };

  const getContext = () => state.get().context as Readonly<C>;

  const getCurrent = () => {
    const snapshot = state.get();
    return {
      step: snapshot.step,
      data: snapshot.data[snapshot.step] as Readonly<D[S]> | undefined,
      ctx: snapshot.context as Readonly<C>,
    };
  };

  return {
    cloneContext,
    getContext,
    getCurrent,
    updateContext,
    setStepData,
  };
}
