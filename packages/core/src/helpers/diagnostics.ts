import type { WizardState } from '../types';
import type { StateAccess } from './stateAccess';

export type DiagnosticsApi<C, S extends string, D extends Record<S, unknown>> = {
  stepAttempts(step: S): number;
  stepDuration(step: S): number | null;
  snapshot(): WizardState<C, S, D>;
};

export function createDiagnosticsApi<C, S extends string, D extends Record<S, unknown>>(
  state: StateAccess<C, S, D>
): DiagnosticsApi<C, S, D> {
  const stepAttempts = (step: S): number => {
    return state.get().runtime?.[step]?.attempts ?? 0;
  };

  const stepDuration = (step: S): number | null => {
    const runtime = state.get().runtime?.[step];
    if (runtime?.startedAt && runtime?.finishedAt) {
      return runtime.finishedAt - runtime.startedAt;
    }
    return null;
  };

  const snapshot = (): WizardState<C, S, D> => {
    return structuredClone(state.get());
  };

  return {
    stepAttempts,
    stepDuration,
    snapshot,
  };
}
