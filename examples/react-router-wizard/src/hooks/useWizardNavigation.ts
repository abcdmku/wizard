import { useNavigate, useRouter } from '@tanstack/react-router';
import { useWizardRouterConfig } from '../context/WizardRouterContext';

const stepRoutes = {
  account: '/checkout/account',
  shipping: '/checkout/shipping',
  payment: '/checkout/payment',
  review: '/checkout/review',
} as const;

/**
 * Hook that provides navigation methods that respect history mode
 * In history mode, browser back/forward buttons work as prev/next
 */
export function useWizardNavigation() {
  const navigate = useNavigate();
  const router = useRouter();
  const config = useWizardRouterConfig();

  const goToStep = (step: keyof typeof stepRoutes) => {
    navigate({ to: stepRoutes[step] });
  };

  const goBack = () => {
    if (config.historyMode) {
      // In history mode, use browser back button
      router.history.back();
    } else {
      // In non-history mode, navigate directly
      // This would need additional logic to determine previous step
      router.history.back();
    }
  };

  const goForward = () => {
    if (config.historyMode) {
      // In history mode, use browser forward button
      router.history.forward();
    } else {
      // In non-history mode, navigate directly
      router.history.forward();
    }
  };

  return {
    goToStep,
    goBack,
    goForward,
    historyMode: config.historyMode,
  };
}
