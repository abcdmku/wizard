import React, { useState } from 'react';

/**
 * Full-featured step branching with visual flow and enhanced UX
 */
export function StepBranchingFull() {
  const [userType, setUserType] = useState<'individual' | 'business' | null>(null);
  const [currentStep, setCurrentStep] = useState('userType');
  const [stepData, setStepData] = useState<Record<string, any>>({});

  const getStepFlow = () => {
    if (!userType) return ['userType'];
    return userType === 'individual' 
      ? ['userType', 'individual', 'payment']
      : ['userType', 'business', 'taxInfo', 'payment'];
  };

  const stepFlow = getStepFlow();
  const currentIndex = stepFlow.indexOf(currentStep);

  const selectUserType = (type: 'individual' | 'business') => {
    setUserType(type);
    setCurrentStep(type);
    setStepData({ ...stepData, userType: type });
  };

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

  const restart = () => {
    setUserType(null);
    setCurrentStep('userType');
    setStepData({});
  };

  const getStepTitle = (step: string) => {
    const titles: Record<string, string> = {
      userType: 'User Type',
      individual: 'Individual Info',
      business: 'Business Details',
      taxInfo: 'Tax Information',
      payment: 'Payment'
    };
    return titles[step] || step;
  };

  return (
    <div className="max-w-2xl">
      <div className="border border-gray-300 dark:border-gray-700 rounded-lg p-6 bg-white dark:bg-gray-800 shadow-sm">
        {/* Account Type Selector - Always Visible */}
        <div className="mb-8 pb-6 border-b border-gray-300 dark:border-gray-700">
          <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Account Type:
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => selectUserType('individual')}
              className={`px-4 py-2 rounded-md transition-all ${
                userType === 'individual'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              👤 Individual
            </button>
            <button
              onClick={() => selectUserType('business')}
              className={`px-4 py-2 rounded-md transition-all ${
                userType === 'business'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              🏢 Business
            </button>
          </div>
        </div>
      </div>

      {userType ? (
        <>
          {/* Visual Step Flow */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {stepFlow.map((step, index) => (
                <React.Fragment key={step}>
                  <div
                    className={`flex flex-col items-center cursor-pointer`}
                    onClick={() => index <= currentIndex && setCurrentStep(step)}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                        index === currentIndex
                          ? 'bg-blue-600 text-white'
                          : index < currentIndex
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {index < currentIndex ? '✓' : index + 1}
                    </div>
                    <span
                      className={`mt-2 text-xs font-medium ${
                        index === currentIndex
                          ? 'text-blue-600 dark:text-blue-400'
                          : index < currentIndex
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {getStepTitle(step)}
                    </span>
                  </div>
                  {index < stepFlow.length - 1 && (
                    <div
                      className={`flex-1 h-1 mx-2 transition-all ${
                        index < currentIndex
                          ? 'bg-green-600'
                          : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Step Content */}
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              {getStepTitle(currentStep)}
            </h3>
            
            {currentStep === 'userType' && (
              <p className="text-gray-600 dark:text-gray-400">
                Choose account type
              </p>
            )}
            
            {currentStep === 'individual' && (
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Enter your full name"
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                  onChange={(e) => setStepData({ ...stepData, name: e.target.value })}
                />
                <input
                  type="email"
                  placeholder="Enter your email"
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                  onChange={(e) => setStepData({ ...stepData, email: e.target.value })}
                />
              </div>
            )}
            
            {currentStep === 'business' && (
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Company name"
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                  onChange={(e) => setStepData({ ...stepData, company: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Business registration number"
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                  onChange={(e) => setStepData({ ...stepData, regNumber: e.target.value })}
                />
              </div>
            )}
            
            {currentStep === 'taxInfo' && (
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Tax ID"
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                  onChange={(e) => setStepData({ ...stepData, taxId: e.target.value })}
                />
                <select
                  className="w-full px-3 py-2 border rounded-md bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                  onChange={(e) => setStepData({ ...stepData, taxType: e.target.value })}
                >
                  <option value="">Select tax type</option>
                  <option value="corporation">Corporation</option>
                  <option value="llc">LLC</option>
                  <option value="partnership">Partnership</option>
                </select>
              </div>
            )}
            
            {currentStep === 'payment' && (
              <div>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  Complete payment setup for your {userType} account
                </p>
                <div className="bg-white dark:bg-gray-900 p-4 rounded border border-gray-200 dark:border-gray-700">
                  <pre className="text-xs text-gray-700 dark:text-gray-300">
                    {JSON.stringify(stepData, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={restart}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              ↺ Start Over
            </button>
            
            <div className="flex gap-3">
              <button
                onClick={goBack}
                disabled={currentIndex === 0}
                className="px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                ← Previous
              </button>
              <button
                onClick={goNext}
                disabled={currentIndex === stepFlow.length - 1}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {currentIndex === stepFlow.length - 1 ? 'Complete ✓' : 'Continue →'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          Please select an account type above to begin
        </div>
      )}
      </div>
    </div>
  );
}