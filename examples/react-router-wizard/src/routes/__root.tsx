import { createRootRoute, Outlet } from '@tanstack/react-router';
import { WizardProvider } from '@wizard/react';
import { ThemeProvider } from '../hooks/useTheme';
import { WizardRouterProvider } from '../context/WizardRouterContext';
import { checkoutWizard } from '../wizard';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <ThemeProvider>
      <WizardRouterProvider config={{ historyMode: true }}>
        <WizardProvider wizard={checkoutWizard}>
          <Outlet />
        </WizardProvider>
      </WizardRouterProvider>
    </ThemeProvider>
  );
}
