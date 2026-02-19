import { useNavigate, useParams } from '@tanstack/react-router';
import type { Wizard } from '@wizard/core';
import { useSyncWizardWithRouter } from './router';

export interface TanStackWizardRouterOptions<S extends string> {
  basePath: string;
  paramName?: string;
  toStep?: (param: string) => S | null;
  toPath?: (step: S) => string;
}

/**
 * TanStack Router adapter built on top of useSyncWizardWithRouter.
 */
export function useTanStackWizardRouter<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(
  wizard: Wizard<C, S, D, E, EM>,
  options: TanStackWizardRouterOptions<S>
) {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const paramName = options.paramName ?? 'step';

  useSyncWizardWithRouter(wizard, {
    param: paramName,
    toStep: options.toStep ?? ((param) => param as S),
    toUrl: (step) => ({
      to: options.toPath?.(step) ?? `${options.basePath}/${String(step)}`,
    }),
    navigate: (next) => {
      void navigate({ to: next.to } as never);
    },
    getParam: () => params[paramName] as string | undefined,
  });
}
