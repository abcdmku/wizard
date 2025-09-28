import { useWizardState } from '@wizard/react';
import { Introduction, Authentication, SecureData, Confirmation } from './steps';
import { StepIndicator } from './ui/StepIndicator';
import { GuardStatus } from './ui/GuardStatus';

const stepComponents = {
  introduction: Introduction,
  authentication: Authentication,
  secureData: SecureData,
  confirmation: Confirmation,
};

export function WizardContainer() {
  const state = useWizardState();
  const currentStep = state.step as keyof typeof stepComponents;
  const StepComponent = stepComponents[currentStep];

  if (!StepComponent) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600">Unknown step: {currentStep}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Router Guard Wizard Demo
          </h1>
          <p className="text-gray-600">
            Experience navigation guards, authentication checks, and step locking
          </p>
        </header>

        <GuardStatus />
        <StepIndicator />

        <div className="bg-white rounded-lg shadow-md p-6 mt-6">
          <StepComponent />
        </div>

        <footer className="mt-8 text-center text-sm text-gray-500">
          <p>
            This wizard demonstrates various guard features including exit warnings,
            authentication requirements, and step locking.
          </p>
        </footer>
      </div>
    </div>
  );
}