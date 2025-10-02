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
      const currentStepWrapper = checkoutWizard.getCurrentStep();
      const currentStepName = currentStepWrapper.name;

      if (currentStepName !== targetStep) {
        // Use goTo to update wizard's internal current step
        checkoutWizard.goTo(targetStep).catch(err => {
          console.error('Failed to sync wizard to step:', targetStep, err);
        });
      }
    }
  }, [location.pathname]);
}
