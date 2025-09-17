import React, { useState } from 'react';

/**
 * Step branching with validation
 * Shows how to validate data before allowing progression
 */
export function StepBranchingWithValidation() {
  const [currentStep, setCurrentStep] = useState('userType');
  const [userType, setUserType] = useState<'individual' | 'business' | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const getStepFlow = () => {
    if (!userType) return ['userType'];
    return userType === 'individual' 
      ? ['userType', 'individual', 'payment']
      : ['userType', 'business', 'taxInfo', 'payment'];
  };

  const stepFlow = getStepFlow();
  const currentIndex = stepFlow.indexOf(currentStep);

  const validateStep = (step: string): boolean => {
    const newErrors: Record<string, string> = {};
    
    switch (step) {
      case 'individual':
        if (!formData.name?.trim()) {
          newErrors.name = 'Name is required';
        }
        if (!formData.email?.includes('@')) {
          newErrors.email = 'Valid email is required';
        }
        break;
        
      case 'business':
        if (!formData.companyName?.trim()) {
          newErrors.companyName = 'Company name is required';
        }
        if (!formData.regNumber?.trim()) {
          newErrors.regNumber = 'Registration number is required';
        }
        break;
        
      case 'taxInfo':
        if (!formData.taxId?.trim()) {
          newErrors.taxId = 'Tax ID is required';
        }
        break;
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const goNext = () => {
    if (validateStep(currentStep) && currentIndex < stepFlow.length - 1) {
      setCurrentStep(stepFlow[currentIndex + 1]);
      setErrors({});
    }
  };

  const goBack = () => {
    if (currentIndex > 0) {
      setCurrentStep(stepFlow[currentIndex - 1]);
      setErrors({});
    }
  };

  return (
    <div className="p-6 max-w-lg">
      <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
        Step: {currentStep} (With Validation)
      </h3>
      
      {currentStep === 'userType' && (
        <div className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">Select account type:</p>
          <div className="flex gap-3">
            <button 
              onClick={() => { 
                setUserType('individual'); 
                setCurrentStep('individual');
                setFormData({});
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Individual
            </button>
            <button 
              onClick={() => { 
                setUserType('business'); 
                setCurrentStep('business');
                setFormData({});
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Business
            </button>
          </div>
        </div>
      )}

      {currentStep === 'individual' && (
        <div className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="Full Name"
              value={formData.name || ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md transition-colors
                bg-white dark:bg-gray-800 
                text-gray-900 dark:text-gray-100
                placeholder-gray-400 dark:placeholder-gray-500
                ${errors.name 
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500' 
                  : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500'
                }
                focus:outline-none focus:ring-2`}
            />
            {errors.name && (
              <span className="text-red-500 text-sm mt-1 block">{errors.name}</span>
            )}
          </div>
          
          <div>
            <input
              type="email"
              placeholder="Email"
              value={formData.email || ''}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md transition-colors
                bg-white dark:bg-gray-800 
                text-gray-900 dark:text-gray-100
                placeholder-gray-400 dark:placeholder-gray-500
                ${errors.email 
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500' 
                  : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500'
                }
                focus:outline-none focus:ring-2`}
            />
            {errors.email && (
              <span className="text-red-500 text-sm mt-1 block">{errors.email}</span>
            )}
          </div>
        </div>
      )}

      {currentStep === 'business' && (
        <div className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="Company Name"
              value={formData.companyName || ''}
              onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md transition-colors
                bg-white dark:bg-gray-800 
                text-gray-900 dark:text-gray-100
                placeholder-gray-400 dark:placeholder-gray-500
                ${errors.companyName 
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500' 
                  : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500'
                }
                focus:outline-none focus:ring-2`}
            />
            {errors.companyName && (
              <span className="text-red-500 text-sm mt-1 block">{errors.companyName}</span>
            )}
          </div>
          
          <div>
            <input
              type="text"
              placeholder="Registration Number"
              value={formData.regNumber || ''}
              onChange={(e) => setFormData({ ...formData, regNumber: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md transition-colors
                bg-white dark:bg-gray-800 
                text-gray-900 dark:text-gray-100
                placeholder-gray-400 dark:placeholder-gray-500
                ${errors.regNumber 
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500' 
                  : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500'
                }
                focus:outline-none focus:ring-2`}
            />
            {errors.regNumber && (
              <span className="text-red-500 text-sm mt-1 block">{errors.regNumber}</span>
            )}
          </div>
        </div>
      )}

      {currentStep === 'taxInfo' && (
        <div className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="Tax ID"
              value={formData.taxId || ''}
              onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
              className={`w-full px-3 py-2 border rounded-md transition-colors
                bg-white dark:bg-gray-800 
                text-gray-900 dark:text-gray-100
                placeholder-gray-400 dark:placeholder-gray-500
                ${errors.taxId 
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500' 
                  : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500'
                }
                focus:outline-none focus:ring-2`}
            />
            {errors.taxId && (
              <span className="text-red-500 text-sm mt-1 block">{errors.taxId}</span>
            )}
          </div>
        </div>
      )}

      {currentStep === 'payment' && (
        <div className="space-y-4">
          <p className="text-gray-700 dark:text-gray-300">
            Payment setup for {userType} account
          </p>
          <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-3 rounded-md overflow-auto">
            {JSON.stringify(formData, null, 2)}
          </pre>
        </div>
      )}

      {currentStep !== 'userType' && (
        <div className="flex gap-3 mt-6">
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
            {currentIndex === stepFlow.length - 1 ? 'Complete' : 'Next'}
          </button>
        </div>
      )}

      {/* Step progress indicator */}
      <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <span>Step {currentIndex + 1} of {stepFlow.length}</span>
          <span className="text-xs">{stepFlow.join(' → ')}</span>
        </div>
        <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / stepFlow.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}