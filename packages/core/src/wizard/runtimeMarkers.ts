import type { WizardConfig, StepStatus, StepRuntime } from '../types';
import type { StateManager } from './stateManager';

type RuntimeMap<S extends string> = Partial<Record<S, StepRuntime>>;

export type StatusMarkers<S extends string> = {
  markError(step: S, error: unknown): void;
  markTerminated(step: S, error?: unknown): void;
  markLoading(step: S): void;
  markIdle(step: S): void;
  markSkipped(step: S): void;
};

export function createStatusMarkers<C, S extends string, D extends Record<S, unknown>>(
  config: WizardConfig<C, S, D, any>,
  state: StateManager<C, S, D>
): StatusMarkers<S> {
  const emitStatusChange = (step: S, next: StepStatus) => {
    if (!config.onStatusChange) {
      return;
    }

    const previous = state.get().runtime?.[step]?.status;
    if (previous === next) {
      return;
    }

    config.onStatusChange({
      step,
      prev: previous,
      next,
    });
  };

  const markError = (step: S, error: unknown) => {
    emitStatusChange(step, 'error');
    state.update((prev) => ({
      ...prev,
      runtime: {
        ...prev.runtime,
        [step]: {
          ...prev.runtime?.[step],
          status: 'error',
        },
      },
      errors: {
        ...prev.errors,
        [step]: error,
      },
    }));
  };

  const markTerminated = (step: S, error?: unknown) => {
    emitStatusChange(step, 'terminated');
    state.update((prev) => ({
      ...prev,
      runtime: {
        ...prev.runtime,
        [step]: {
          ...prev.runtime?.[step],
          status: 'terminated',
        },
      },
      errors: error
        ? {
            ...prev.errors,
            [step]: error,
          }
        : prev.errors,
    }));
  };

  const markLoading = (step: S) => {
    emitStatusChange(step, 'loading');
    state.update((prev) => ({
      ...prev,
      runtime: {
        ...prev.runtime,
        [step]: {
          ...prev.runtime?.[step],
          status: 'loading',
        },
      },
    }));
  };

  const markIdle = (step: S) => {
    state.update((prev) => {
      const current = prev.runtime?.[step];
      if (!current) {
        return prev;
      }

      const { status: _status, ...rest } = current;
      const nextRuntime: RuntimeMap<S> = { ...(prev.runtime ?? {}) };
      if (Object.keys(rest).length === 0) {
        delete nextRuntime[step];
      } else {
        nextRuntime[step] = rest;
      }

      return {
        ...prev,
        runtime: nextRuntime,
      };
    });
  };

  const markSkipped = (step: S) => {
    emitStatusChange(step, 'skipped');
    state.update((prev) => ({
      ...prev,
      runtime: {
        ...prev.runtime,
        [step]: {
          ...prev.runtime?.[step],
          status: 'skipped',
        },
      },
    }));
  };

  return {
    markError,
    markTerminated,
    markLoading,
    markIdle,
    markSkipped,
  };
}









