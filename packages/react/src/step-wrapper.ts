/**
 * @wizard/react - React Step Wrapper
 * Extends core WizardStep with React component support
 */

import { WizardStep as CoreWizardStep } from '@wizard/core';
import type { ReactWizardStep, ComponentLike } from './types';

/**
 * Concrete implementation of ReactWizardStep interface
 * Wraps a core WizardStep and adds component getter
 */
export class ReactWizardStepImpl<
  StepName extends AllSteps,
  Data extends DataMap[StepName],
  Context,
  AllSteps extends string = string,
  DataMap extends Record<AllSteps, unknown> = Record<AllSteps, unknown>
> implements ReactWizardStep<StepName, Data, Context, AllSteps, DataMap> {

  constructor(
    private readonly _coreStep: CoreWizardStep<StepName, Data, Context, AllSteps, DataMap>,
    private readonly _getComponent: (stepName: AllSteps) => ComponentLike | undefined
  ) {}

  // Delegate all core step properties and methods
  get name() { return this._coreStep.name; }
  get data() { return this._coreStep.data; }
  get meta() { return this._coreStep.meta; }
  get context() { return this._coreStep.context; }
  get wizard() { return this._coreStep.wizard; }
  get error() { return this._coreStep.error; }
  get status() { return this._coreStep.status; }

  // React-specific: component getter
  get component(): ComponentLike | undefined {
    return this._getComponent(this.name as AllSteps);
  }

  // Delegate all methods
  markIdle = (): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap> => {
    const result = this._coreStep.markIdle();
    return new ReactWizardStepImpl(result, this._getComponent);
  }

  markLoading = (): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap> => {
    const result = this._coreStep.markLoading();
    return new ReactWizardStepImpl(result, this._getComponent);
  }

  markSkipped = (): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap> => {
    const result = this._coreStep.markSkipped();
    return new ReactWizardStepImpl(result, this._getComponent);
  }

  markError = (error: unknown): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap> => {
    const result = this._coreStep.markError(error);
    return new ReactWizardStepImpl(result, this._getComponent);
  }

  markTerminated = (error?: unknown): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap> => {
    const result = this._coreStep.markTerminated(error);
    return new ReactWizardStepImpl(result, this._getComponent);
  }

  setData = (data: Data): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap> => {
    const result = this._coreStep.setData(data);
    return new ReactWizardStepImpl(result, this._getComponent);
  }

  updateData(updater: Partial<Data>): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap>;
  updateData(updater: (data: Data | undefined) => Partial<Data>): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap>;
  updateData(updater: Partial<Data> | ((data: Data | undefined) => Partial<Data>)): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap> {
    const result = this._coreStep.updateData(updater as any);
    return new ReactWizardStepImpl(result, this._getComponent);
  }

  setMeta = (meta: any): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap> => {
    const result = this._coreStep.setMeta(meta);
    return new ReactWizardStepImpl(result, this._getComponent);
  }

  updateMeta = (updater: any): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap> => {
    const result = this._coreStep.updateMeta(updater);
    return new ReactWizardStepImpl(result, this._getComponent);
  }

  next = async (): Promise<ReactWizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap>> => {
    const result = await this._coreStep.next();
    return new ReactWizardStepImpl(result, this._getComponent) as ReactWizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap>;
  }

  goTo = async <Target extends AllSteps>(step: Target): Promise<ReactWizardStep<Target, DataMap[Target], Context, AllSteps, DataMap>> => {
    const result = await this._coreStep.goTo(step);
    return new ReactWizardStepImpl(result, this._getComponent) as ReactWizardStep<Target, DataMap[Target], Context, AllSteps, DataMap>;
  }

  back = async (): Promise<ReactWizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap>> => {
    const result = await this._coreStep.back();
    return new ReactWizardStepImpl(result, this._getComponent) as ReactWizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap>;
  }

  canNavigateNext = () => this._coreStep.canNavigateNext();
  canNavigateTo = (step: AllSteps) => this._coreStep.canNavigateTo(step);
  canNavigateBack = () => this._coreStep.canNavigateBack();
  clearError = () => this._coreStep.clearError();
}

/**
 * Helper to wrap a core WizardStep with React component support
 */
export function wrapWithReactStep<
  StepName extends AllSteps,
  Data extends DataMap[StepName],
  Context,
  AllSteps extends string,
  DataMap extends Record<AllSteps, unknown>
>(
  coreStep: CoreWizardStep<StepName, Data, Context, AllSteps, DataMap>,
  getComponent: (stepName: AllSteps) => ComponentLike | undefined
): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap> {
  return new ReactWizardStepImpl(coreStep, getComponent);
}
