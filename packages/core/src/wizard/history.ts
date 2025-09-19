import type { StateManager } from './stateManager';

export type HistoryEntry<C, S extends string, D extends Record<S, unknown>> = {
  step: S;
  context: C;
  data: Partial<D>;
};

export type HistoryManager<C, S extends string, D extends Record<S, unknown>> = {
  push(): void;
  peek(): HistoryEntry<C, S, D> | null;
  pop(): HistoryEntry<C, S, D> | null;
};

export function createHistoryManager<C, S extends string, D extends Record<S, unknown>>(
  state: StateManager<C, S, D>,
  options: { keepHistory: boolean; maxHistorySize: number },
  cloneContext: (ctx: C) => C
): HistoryManager<C, S, D> {
  const push = () => {
    if (!options.keepHistory) {
      return;
    }

    state.update((prev) => {
      const entry: HistoryEntry<C, S, D> = {
        step: prev.step,
        context: cloneContext(prev.context),
        data: structuredClone(prev.data),
      };

      const nextHistory = [
        ...prev.history.slice(-(options.maxHistorySize - 1)),
        entry,
      ];

      return {
        ...prev,
        history: nextHistory,
      };
    });
  };

  const peek = (): HistoryEntry<C, S, D> | null => {
    const history = state.get().history;
    if (!options.keepHistory || history.length === 0) {
      return null;
    }
    return history[history.length - 1] ?? null;
  };

  const pop = (): HistoryEntry<C, S, D> | null => {
    const history = state.get().history;
    if (!options.keepHistory || history.length === 0) {
      return null;
    }

    const entry = history[history.length - 1]!;
    state.update((prev) => ({
      ...prev,
      history: prev.history.slice(0, -1),
    }));
    return entry;
  };

  return {
    push,
    peek,
    pop,
  };
}
