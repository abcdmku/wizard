import { useEffect } from 'react';
import { useResumeWizard } from '../wizard/config';
import * as Steps from './steps';
import { StepProgress } from './ui/StepProgress';
import { AutoSaveIndicator } from './ui/AutoSaveIndicator';
import { usePersistence } from '../hooks/usePersistence';
import type { WizardContext } from '../wizard/types';

const stepComponents = {
  personal: Steps.PersonalInfo,
  experience: Steps.WorkExperience,
  education: Steps.Education,
  skills: Steps.Skills,
  projects: Steps.Projects,
  summary: Steps.Summary,
  preview: Steps.Preview,
};

export function WizardContainer() {
  const { step, context, updateContext, goTo } = useResumeWizard();

  // Enable persistence
  usePersistence(context, updateContext);

  // Save current step whenever it changes
  useEffect(() => {
    if (step !== context.currentStep) {
      updateContext((ctx: WizardContext) => {
        ctx.currentStep = step;
        ctx.isDirty = true;
      });
    }
  }, [step, context.currentStep, updateContext]);

  // Restore to saved step on mount
  useEffect(() => {
    if (context.recoveredFromStorage && context.currentStep && context.currentStep !== step) {
      goTo(context.currentStep as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.recoveredFromStorage]);

  const StepComponent = stepComponents[step as keyof typeof stepComponents];
  
  if (!StepComponent) {
    return <div>Unknown step: {step}</div>;
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      <AutoSaveIndicator />
      
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Resume Builder
          </h1>
          <p className="text-gray-600">
            Build your professional resume step by step with auto-save
          </p>
        </header>
        
        <StepProgress />
        
        <div className="bg-white rounded-lg shadow-md p-6">
          <StepComponent />
        </div>
      </div>
    </div>
  );
}