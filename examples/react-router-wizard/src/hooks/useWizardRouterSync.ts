import { useEffect } from 'react';
import { useLocation } from '@tanstack/react-router';
import { checkoutWizard } from '../wizard';

const routeToStepMap: Record<string, 'account' | 'shipping' | 'payment' | 'review'> = {
  '/checkout/account': 'account',
  '/checkout/shipping': 'shipping',
  '/checkout/payment': 'payment',
  '/checkout/review': 'review',
};

export function useWizardRouterSync() {
  const location = useLocation();

  useEffect(() => {
    const targetStep = routeToStepMap[location.pathname];
    if (targetStep) {
      const currentStep = checkoutWizard.getCurrentStep();
      if (currentStep !== targetStep) {
        // Navigate wizard to match the route
        checkoutWizard.goToStep(targetStep);
      }
    }
  }, [location.pathname]);
}
