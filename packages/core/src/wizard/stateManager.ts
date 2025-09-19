import { Store } from '@tanstack/store';
import type { WizardState, WizardPersistence } from '../types';

export type StateManager<C, S extends string, D extends Record<S, unknown>> = {
  store: Store<WizardState<C, S, D>>;
  get(): WizardState<C, S, D>;
  update(updater: (state: WizardState<C, S, D>) => WizardState<C, S, D>): void;
  replace(nextState: WizardState<C, S, D>): void;
  snapshot(): WizardState<C, S, D>;
  restore(snapshot: WizardState<C, S, D>): void;
  subscribe(listener: (state: WizardState<C, S, D>) => void): () => void;
  clearPersistence(): void;
  loadPersistedState(): void;
};

export function createStateManager<C, S extends string, D extends Record<S, unknown>>(
  initialState: WizardState<C, S, D>,
  persistence?: WizardPersistence<C, S, D>
): StateManager<C, S, D> {
  const store = new Store(initialState);

  const saveState = persistence?.save
    ? (state: WizardState<C, S, D>) => {
        void Promise.resolve(persistence!.save!(state));
      }
    : undefined;

  const update = (updater: (state: WizardState<C, S, D>) => WizardState<C, S, D>) => {
    store.setState(updater);
    if (saveState) {
      saveState(store.state);
    }
  };

  const replace = (nextState: WizardState<C, S, D>) => {
    store.setState(() => nextState);
    if (saveState) {
      saveState(store.state);
    }
  };

  const snapshot = () => structuredClone(store.state);
  const restore = (snap: WizardState<C, S, D>) => {
    replace(snap);
  };

  const subscribe = (listener: (state: WizardState<C, S, D>) => void) => {
    return store.subscribe(() => {
      listener(store.state);
    });
  };

  const clearPersistence = () => {
    if (persistence?.clear) {
      void Promise.resolve(persistence.clear());
    }
  };

  const loadPersistedState = () => {
    if (!persistence?.load) {
      return;
    }

    void Promise.resolve(persistence.load()).then((savedState) => {
      if (savedState) {
        store.setState(() => savedState);
      }
    });
  };

  return {
    store,
    get: () => store.state,
    update,
    replace,
    snapshot,
    restore,
    subscribe,
    clearPersistence,
    loadPersistedState,
  };
}
