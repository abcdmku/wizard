import { createContext, useContext, ReactNode } from 'react';
import type { Wizard } from '@wizard/core';

/**
 * Context type holding the wizard instance
 */
type WizardContextValue<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
> = {
  wizard: Wizard<C, S, D, E>;
};

/**
 * React context for wizard instance
 */
const WizardContext = createContext<WizardContextValue<any, any, any, any> | null>(
  null
);

/**
 * Provider component for wizard context
 */
export interface WizardProviderProps<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
> {
  wizard: Wizard<C, S, D, E>;
  children: ReactNode;
}

export function WizardProvider<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>({ wizard, children }: WizardProviderProps<C, S, D, E>) {
  return (
    <WizardContext.Provider value={{ wizard }}>
      {children}
    </WizardContext.Provider>
  );
}

/**
 * Hook to access the wizard instance from context
 * @throws Error if used outside WizardProvider
 */
export function useWizardContext<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(): WizardContextValue<C, S, D, E> {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error('useWizardContext must be used within a WizardProvider');
  }
  return context as WizardContextValue<C, S, D, E>;
}