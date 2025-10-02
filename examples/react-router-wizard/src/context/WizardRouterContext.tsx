import { createContext, useContext, ReactNode } from 'react';
import { WizardRouterConfig, defaultWizardConfig } from '../config/wizardConfig';

const WizardRouterContext = createContext<WizardRouterConfig>(defaultWizardConfig);

export function WizardRouterProvider({
  children,
  config = defaultWizardConfig,
}: {
  children: ReactNode;
  config?: Partial<WizardRouterConfig>;
}) {
  const mergedConfig = { ...defaultWizardConfig, ...config };

  return (
    <WizardRouterContext.Provider value={mergedConfig}>
      {children}
    </WizardRouterContext.Provider>
  );
}

export function useWizardRouterConfig() {
  return useContext(WizardRouterContext);
}
