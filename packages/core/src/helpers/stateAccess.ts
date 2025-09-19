import type { Store } from '@tanstack/store';
import type { WizardState } from '../types';

export type StateAccess<C, S extends string, D extends Record<S, unknown>> = {
  get(): WizardState<C, S, D>;
  trigger(): void;
};

export function createStateAccess<C, S extends string, D extends Record<S, unknown>>(
  store: Store<WizardState<C, S, D>>
): StateAccess<C, S, D> {
  return {
    get: () => store.state,
    trigger: () => {
      store.setState((state) => ({ ...state }));
    },
  };
}
