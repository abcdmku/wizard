import { useWizardState } from '@wizard/react';
import { PersonalInfo, Address, Preferences, Review } from './steps';
import { StepIndicator } from './ui/StepIndicator';
import { ValidationStatus } from './ui/ValidationStatus';

const stepComponents = {
  personalInfo: PersonalInfo,
  address: Address,
  preferences: Preferences,
  review: Review,
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
            Zod Validation Wizard
          </h1>
          <p className="text-gray-600">
            Form validation powered by Zod schemas with real-time error feedback
          </p>
        </header>

        <ValidationStatus />
        <StepIndicator />

        <div className="bg-white rounded-lg shadow-md p-6 mt-6">
          <StepComponent />
        </div>

        <footer className="mt-8 text-center text-sm text-gray-500">
          <p>
            This wizard uses Zod for runtime type validation, ensuring data integrity
            at every step with detailed error messages.
          </p>
        </footer>
      </div>
    </div>
  );
}