/**
 * @wizard/react - React Step Wrapper
 * Extends core WizardStep with React component support.
 */

import * as React from 'react';
import type { StepMetaCore, WizardStep as CoreWizardStep } from '@wizard/core';
import type { ReactWizardStep, StepComponent, StepComponentProps } from './types';

/**
 * Concrete implementation of ReactWizardStep interface.
 * Wraps a core WizardStep and adds a rendered `component` getter.
 */
export class ReactWizardStepImpl<
  StepName extends AllSteps,
  Data extends DataMap[StepName],
  Context,
  AllSteps extends string = string,
  DataMap extends Record<AllSteps, unknown> = Record<AllSteps, unknown>,
  ErrorMap extends Record<AllSteps, unknown> = Record<AllSteps, unknown>
> implements ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> {
  constructor(
    private readonly coreStep: CoreWizardStep<
      StepName,
      Data,
      Context,
      AllSteps,
      DataMap,
      ErrorMap
    >,
    private readonly getComponentForStep: (
      stepName: AllSteps
    ) => StepComponent<
      Context,
      AllSteps,
      DataMap,
      never,
      AllSteps,
      ErrorMap
    > | undefined
  ) {
    this.updateData = this.updateData.bind(this);
  }

  get name() {
    return this.coreStep.name;
  }

  get data() {
    return this.coreStep.data;
  }

  get meta() {
    return this.coreStep.meta;
  }

  get context() {
    return this.coreStep.context;
  }

  get wizard() {
    return this.coreStep.wizard;
  }

  get error() {
    return this.coreStep.error;
  }

  get status() {
    return this.coreStep.status;
  }

  get component(): React.ReactNode {
    const Component = this.getComponentForStep(this.name as AllSteps);
    if (!Component) {
      return null;
    }

    const props: StepComponentProps<
      Context,
      AllSteps,
      DataMap,
      never,
      AllSteps,
      ErrorMap
    > = {
      step: this as unknown as ReactWizardStep<
        AllSteps,
        DataMap[AllSteps],
        Context,
        AllSteps,
        DataMap,
        ErrorMap
      >,
      data: this.data as DataMap[AllSteps] | undefined,
      wizardData: this.wizard.data,
      context: this.context,
      wizard: this.wizard,
    };

    return React.createElement(Component, props);
  }

  markIdle = (): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    return new ReactWizardStepImpl(this.coreStep.markIdle(), this.getComponentForStep);
  };

  markLoading = (): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    return new ReactWizardStepImpl(this.coreStep.markLoading(), this.getComponentForStep);
  };

  markSkipped = (): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    return new ReactWizardStepImpl(this.coreStep.markSkipped(), this.getComponentForStep);
  };

  markError = (
    error: ErrorMap[StepName]
  ): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    return new ReactWizardStepImpl(this.coreStep.markError(error), this.getComponentForStep);
  };

  markTerminated = (
    error?: ErrorMap[StepName]
  ): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    return new ReactWizardStepImpl(
      this.coreStep.markTerminated(error),
      this.getComponentForStep
    );
  };

  setData = (data: Data): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    return new ReactWizardStepImpl(this.coreStep.setData(data), this.getComponentForStep);
  };

  updateData(updater: Partial<Data>): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;
  updateData(
    updater: (data: Data | undefined) => Partial<Data>
  ): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;
  updateData(
    updater: Partial<Data> | ((data: Data | undefined) => Partial<Data>)
  ): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> {
    if (typeof updater === 'function') {
      return new ReactWizardStepImpl(
        this.coreStep.updateData(updater),
        this.getComponentForStep
      );
    }

    return new ReactWizardStepImpl(
      this.coreStep.updateData(updater),
      this.getComponentForStep
    );
  }

  setMeta = (
    meta: StepMetaCore<Context, AllSteps, Data, never>
  ): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    return new ReactWizardStepImpl(this.coreStep.setMeta(meta), this.getComponentForStep);
  };

  updateMeta = (
    updater:
      | Partial<StepMetaCore<Context, AllSteps, Data, never>>
      | ((
          meta: StepMetaCore<Context, AllSteps, Data, never> | undefined
        ) => Partial<StepMetaCore<Context, AllSteps, Data, never>>)
  ): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    return new ReactWizardStepImpl(this.coreStep.updateMeta(updater), this.getComponentForStep);
  };

  next = async (): Promise<ReactWizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap, ErrorMap>> => {
    const result = await this.coreStep.next();
    return new ReactWizardStepImpl(result, this.getComponentForStep);
  };

  goTo = async <Target extends AllSteps>(
    step: Target
  ): Promise<ReactWizardStep<Target, DataMap[Target], Context, AllSteps, DataMap, ErrorMap>> => {
    const result = await this.coreStep.goTo(step);
    return new ReactWizardStepImpl(result, this.getComponentForStep);
  };

  back = async (): Promise<ReactWizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap, ErrorMap>> => {
    const result = await this.coreStep.back();
    return new ReactWizardStepImpl(result, this.getComponentForStep);
  };

  canNavigateNext = () => this.coreStep.canNavigateNext();
  canNavigateTo = (step: AllSteps) => this.coreStep.canNavigateTo(step);
  canNavigateBack = () => this.coreStep.canNavigateBack();
  clearError = () => this.coreStep.clearError();
}

/**
 * Wrap a core WizardStep with React component support.
 */
export function wrapWithReactStep<
  StepName extends AllSteps,
  Data extends DataMap[StepName],
  Context,
  AllSteps extends string,
  DataMap extends Record<AllSteps, unknown>,
  ErrorMap extends Record<AllSteps, unknown>
>(
  coreStep: CoreWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>,
  getComponentForStep: (
    stepName: AllSteps
  ) => StepComponent<
    Context,
    AllSteps,
    DataMap,
    never,
    AllSteps,
    ErrorMap
  > | undefined
): ReactWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> {
  return new ReactWizardStepImpl(coreStep, getComponentForStep);
}
