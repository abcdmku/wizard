import { useEffect } from 'react';
import { useWizard, useWizardStep } from './hooks';

/**
 * Options for syncing wizard with router
 */
export interface SyncWizardWithRouterOptions<S extends string> {
  /** URL parameter name for step (e.g., "stepId") */
  param: string;
  /** Convert URL param to step ID */
  toStep: (param: string) => S | null;
  /** Convert step ID to URL */
  toUrl: (step: S) => { to: string; search?: Record<string, string> };
  /** Router navigation function */
  navigate: (options: { to: string; search?: Record<string, string> }) => void;
  /** Get current param value from router */
  getParam: () => string | undefined;
}

/**
 * Hook to sync wizard state with router
 * Keeps URL and wizard step in sync bidirectionally
 */
export function useSyncWizardWithRouter<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(options: SyncWizardWithRouterOptions<S>) {
  const { toStep, toUrl, navigate, getParam } = options;
  const wizard = useWizard<C, S, D, E>();
  const currentStep = useWizardStep<C, S, D>();

  // Sync wizard → router
  useEffect(() => {
    const urlOptions = toUrl(currentStep);
    const currentParam = getParam();
    const expectedParam = urlOptions.to.split('/').pop(); // Simple extraction
    
    if (currentParam !== expectedParam) {
      navigate(urlOptions);
    }
  }, [currentStep, toUrl, navigate, getParam]);

  // Sync router → wizard
  useEffect(() => {
    const currentParam = getParam();
    if (!currentParam) return;

    const targetStep = toStep(currentParam);
    if (!targetStep) return;

    if (targetStep !== currentStep) {
      wizard.goTo(targetStep).catch((error) => {
        // If can't navigate to step, redirect to current valid step
        console.warn(`Cannot navigate to step ${targetStep}:`, error);
        const validUrl = toUrl(currentStep);
        navigate(validUrl);
      });
    }
  }, [getParam, toStep, currentStep, wizard, toUrl, navigate]);
}

/**
 * Helper for TanStack Router v1 integration
 * This is a convenience wrapper around useSyncWizardWithRouter
 */
export function useTanStackRouterSync<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(
  options: Omit<SyncWizardWithRouterOptions<S>, 'navigate' | 'getParam'> & {
    // These would come from TanStack Router hooks
    // Users need to provide them since we don't have hard dependency
    useNavigate: () => (options: any) => void;
    useParams: () => Record<string, string>;
  }
) {
  const navigate = options.useNavigate();
  const params = options.useParams();
  
  return useSyncWizardWithRouter<C, S, D, E>({
    ...options,
    navigate,
    getParam: () => params[options.param],
  });
}