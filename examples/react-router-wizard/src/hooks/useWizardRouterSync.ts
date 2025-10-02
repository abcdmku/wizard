import { useEffect, useRef } from 'react';
import { useLocation } from '@tanstack/react-router';
import { checkoutWizard } from '../wizard';
import { useWizardRouterConfig } from '../context/WizardRouterContext';

const routeToStepMap: Record<string, 'account' | 'shipping' | 'payment' | 'review'> = {
  '/checkout/account': 'account',
  '/checkout/shipping': 'shipping',
  '/checkout/payment': 'payment',
  '/checkout/review': 'review',
};

export function useWizardRouterSync() {
  const location = useLocation();
  const config = useWizardRouterConfig();
  const isNavigatingRef = useRef(false);

  useEffect(() => {
    const targetStep = routeToStepMap[location.pathname];
    if (!targetStep) return;

    const currentStepWrapper = checkoutWizard.getCurrentStep();
    const currentStepName = currentStepWrapper.name;

    if (currentStepName !== targetStep) {
      isNavigatingRef.current = true;

      // Use goTo to update wizard's internal current step
      checkoutWizard.goTo(targetStep).catch(err => {
        console.error('Failed to sync wizard to step:', targetStep, err);
      }).finally(() => {
        isNavigatingRef.current = false;
      });
    }
  }, [location.pathname]);

  // Handle browser back/forward buttons as prev/next in history mode
  useEffect(() => {
    if (!config.historyMode) return;

    const handlePopState = () => {
      // Browser navigation already updated the route
      // The effect above will sync the wizard
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [config.historyMode]);
}
