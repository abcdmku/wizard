import { useEffect, useState } from 'react';
import { WizardProvider } from '@wizard/react';
import { simpleWizard, saveToStorage, loadFromStorage, clearStorage, type FormData } from './wizard/config';
import { NameStep } from './components/NameStep';
import { EmailStep } from './components/EmailStep';
import { ReviewStep } from './components/ReviewStep';

function App() {
  return (
    <WizardProvider wizard={simpleWizard}>
      <WizardContent />
    </WizardProvider>
  );
}

function WizardContent() {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    age: '',
    terms: false,
  });

  const [currentStep, setCurrentStep] = useState<'name' | 'email' | 'review'>('name');
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = loadFromStorage();
    if (saved) {
      setFormData(saved.data);
      setCurrentStep(saved.currentStep);
      setLastSaved(saved.timestamp);
      setRecovered(true);
    }
  }, []);

  // Save to localStorage whenever data or step changes
  useEffect(() => {
    if (formData.name || formData.email) {
      saveToStorage(formData, currentStep);
      setLastSaved(new Date().toISOString());
    }
  }, [formData, currentStep]);

  const handleNext = (data: FormData) => {
    setFormData(data);
    if (currentStep === 'name') setCurrentStep('email');
    else if (currentStep === 'email') setCurrentStep('review');
  };

  const handleBack = () => {
    if (currentStep === 'email') setCurrentStep('name');
    else if (currentStep === 'review') setCurrentStep('email');
  };

  const handleSubmit = () => {
    alert(`Form submitted!\n\nName: ${formData.name}\nEmail: ${formData.email}\nAge: ${formData.age}`);
    clearStorage();
    setFormData({ name: '', email: '', age: '', terms: false });
    setCurrentStep('name');
    setLastSaved(null);
    setRecovered(false);
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to reset? All data will be lost.')) {
      clearStorage();
      setFormData({ name: '', email: '', age: '', terms: false });
      setCurrentStep('name');
      setLastSaved(null);
      setRecovered(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Simple Form Wizard
          </h1>
          <p className="text-gray-600">
            With automatic localStorage persistence
          </p>
        </div>

        {/* Save Status */}
        <div className="mb-6 flex items-center justify-between bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center gap-2">
            {lastSaved ? (
              <>
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm text-gray-600">
                  Saved at {new Date(lastSaved).toLocaleTimeString()}
                </span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
                <span className="text-sm text-gray-600">No data saved</span>
              </>
            )}
          </div>

          {recovered && (
            <span className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-full">
              ✓ Recovered from localStorage
            </span>
          )}
        </div>

        {/* Progress Bar */}
        <div className="mb-8 bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between mb-2">
            {['Name', 'Contact', 'Review'].map((label, idx) => {
              const stepNames = ['name', 'email', 'review'];
              const isActive = stepNames[idx] === currentStep;
              const isComplete = stepNames.indexOf(currentStep) > idx;

              return (
                <div key={label} className="flex flex-col items-center flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : isComplete
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {isComplete ? '✓' : idx + 1}
                  </div>
                  <div className={`mt-2 text-sm ${isActive ? 'font-semibold' : ''}`}>
                    {label}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{
                width: `${
                  currentStep === 'name' ? 33 : currentStep === 'email' ? 66 : 100
                }%`,
              }}
            />
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          {currentStep === 'name' && (
            <NameStep data={formData} onNext={handleNext} />
          )}
          {currentStep === 'email' && (
            <EmailStep data={formData} onNext={handleNext} onBack={handleBack} />
          )}
          {currentStep === 'review' && (
            <ReviewStep data={formData} onBack={handleBack} onSubmit={handleSubmit} />
          )}
        </div>

        {/* Reset Button */}
        {(formData.name || formData.email) && (
          <div className="mt-6 text-center">
            <button
              onClick={handleReset}
              className="text-sm text-red-600 hover:text-red-700 underline"
            >
              Reset and clear localStorage
            </button>
          </div>
        )}

        {/* Instructions */}
        <div className="mt-8 bg-white rounded-lg shadow-sm p-6">
          <h3 className="font-semibold mb-2">Try it out:</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• Fill in some data and refresh the page - your progress is saved!</li>
            <li>• Navigate between steps - the current step is remembered</li>
            <li>• Close the tab and come back - everything is restored</li>
            <li>• Submit the form to clear localStorage</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default App;
