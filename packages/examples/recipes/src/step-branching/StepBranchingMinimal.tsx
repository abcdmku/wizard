import React, { useState } from 'react';
import { createWizard } from './wizard-logic';

/**
 * Minimal example of dynamic step branching
 * Shows only the essential logic for branching based on user type
 */
export function StepBranchingMinimal() {
  const [userType, setUserType] = useState<'individual' | 'business' | null>(null);
  const [currentStep, setCurrentStep] = useState('userType');

  // Minimal step flow logic
  const getStepFlow = () => {
    if (!userType) return ['userType'];
    return userType === 'individual' 
      ? ['userType', 'individual', 'payment']
      : ['userType', 'business', 'taxInfo', 'payment'];
  };

  const stepFlow = getStepFlow();
  const currentIndex = stepFlow.indexOf(currentStep);

  const goNext = () => {
    if (currentIndex < stepFlow.length - 1) {
      setCurrentStep(stepFlow[currentIndex + 1]);
    }
  };

  const goBack = () => {
    if (currentIndex > 0) {
      setCurrentStep(stepFlow[currentIndex - 1]);
    }
  };

  return (
    <div className="p-6 max-w-md">
      <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
        Step: {currentStep}
      </h3>
      
      {currentStep === 'userType' && (
        <div className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">Select account type:</p>
          <div className="flex gap-3">
            <button 
              onClick={() => { setUserType('individual'); setCurrentStep('individual'); }}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Individual
            </button>
            <button 
              onClick={() => { setUserType('business'); setCurrentStep('business'); }}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Business
            </button>
          </div>
        </div>
      )}

      {currentStep !== 'userType' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Current flow: {stepFlow.join(' → ')}
          </p>
          <div className="flex gap-3">
            <button 
              onClick={goBack} 
              disabled={currentIndex === 0}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Back
            </button>
            <button 
              onClick={goNext} 
              disabled={currentIndex === stepFlow.length - 1}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Export the logic for reuse
export const minimalStepBranchingLogic = {
  getStepFlow: (userType: string | null): string[] => {
    if (!userType) return ['userType'];
    return userType === 'individual' 
      ? ['userType', 'individual', 'payment']
      : ['userType', 'business', 'taxInfo', 'payment'];
  }
};