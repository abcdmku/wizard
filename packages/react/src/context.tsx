import { createContext, useContext, type ReactNode } from 'react';
import type { Wizard } from '@wizard/core';

/**
 * React context for wizard instance
 */
export const WizardContext = createContext<Wizard<any, any, any, any, any> | null>(
  null
);

/**
 * Provider component props
 */
export interface WizardProviderProps<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
> {
  wizard: Wizard<C, S, D, E, EM>;
  children: ReactNode;
}

/**
 * Provider component for wizard context.
 * Wrap your application with this to enable wizard hooks.
 *
 * @example
 * ```tsx
 * <WizardProvider wizard={FormWizard}>
 *   <App />
 * </WizardProvider>
 * ```
 */
export function WizardProvider<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>({ wizard, children }: WizardProviderProps<C, S, D, E, EM>) {
  return (
    <WizardContext.Provider value={wizard}>
      {children}
    </WizardContext.Provider>
  );
}

/**
 * Internal hook to access the wizard instance from context.
 * @throws Error if used outside WizardProvider
 * @internal
 */
export function useWizardContext<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(): Wizard<C, S, D, E, EM> {
  const wizard = useContext(WizardContext);
  if (!wizard) {
    throw new Error(
      'Wizard context not found. Make sure your component is wrapped with <WizardProvider>.'
    );
  }
  return wizard as Wizard<C, S, D, E, EM>;
}
