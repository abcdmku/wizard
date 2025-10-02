import { createRootRoute, Outlet } from '@tanstack/react-router';
import { WizardProvider } from '@wizard/react';
import { ThemeProvider } from '../hooks/useTheme';
import { checkoutWizard } from '../wizard';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <ThemeProvider>
      <WizardProvider wizard={checkoutWizard}>
        <Outlet />
      </WizardProvider>
    </ThemeProvider>
  );
}
