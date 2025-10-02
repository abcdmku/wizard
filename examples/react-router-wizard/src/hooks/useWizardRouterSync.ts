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
        // Use the step's enter method to navigate the wizard
        const targetStepWrapper = checkoutWizard.getStep(targetStep);
        targetStepWrapper.enter();
      }
    }
  }, [location.pathname]);
}
