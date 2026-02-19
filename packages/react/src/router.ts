import { useEffect, useRef } from 'react';
import type { Wizard } from '@wizard/core';
import { useWizardSelector } from './hooks';

export interface SyncWizardWithRouterOptions<S extends string> {
  /**
   * URL parameter name for the current step.
   */
  param: string;
  /**
   * Convert URL param value to a wizard step.
   */
  toStep: (param: string) => S | null;
  /**
   * Convert wizard step to route navigation options.
   */
  toUrl: (step: S) => { to: string; search?: Record<string, string> };
  /**
   * Router navigation function.
   */
  navigate: (options: { to: string; search?: Record<string, string> }) => void;
  /**
   * Read current URL param value.
   */
  getParam: () => string | undefined;
}

/**
 * Keep wizard state and router param in sync without mutating wizard methods.
 */
export function useSyncWizardWithRouter<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(
  wizard: Wizard<C, S, D, E, EM>,
  options: SyncWizardWithRouterOptions<S>
) {
  const { toStep, toUrl, navigate, getParam } = options;
  const currentStep = useWizardSelector(wizard, (state) => state.step);
  const syncingFromRouter = useRef(false);
  const syncingFromWizard = useRef(false);

  useEffect(() => {
    if (syncingFromRouter.current) {
      syncingFromRouter.current = false;
      return;
    }

    const currentParam = getParam();
    const targetParam = String(currentStep);
    if (currentParam === targetParam) {
      return;
    }

    syncingFromWizard.current = true;
    navigate(toUrl(currentStep));
  }, [currentStep, getParam, navigate, toUrl]);

  useEffect(() => {
    const currentParam = getParam();
    if (!currentParam) {
      return;
    }

    if (syncingFromWizard.current) {
      syncingFromWizard.current = false;
      return;
    }

    const targetStep = toStep(currentParam);
    if (!targetStep || targetStep === currentStep) {
      return;
    }

    syncingFromRouter.current = true;
    void wizard.goTo(targetStep).catch(() => {
      syncingFromRouter.current = false;
    });
  }, [currentStep, getParam, toStep, wizard]);
}
