import { useEffect, useState, useCallback, useRef } from 'react';
import { WizardProvider } from '@wizard/react';
import { ThemeProvider } from './hooks/useTheme';
import { simpleWizard, saveToStorage, loadFromStorage, clearStorage, type FormData } from './wizard/config';
import { NameStep } from './components/NameStep';
import { EmailStep } from './components/EmailStep';
import { ReviewStep } from './components/ReviewStep';
import { ThemeToggle } from './components/ThemeToggle';

function App() {
  return (
    <ThemeProvider>
      <WizardProvider wizard={simpleWizard}>
        <WizardContent />
      </WizardProvider>
    </ThemeProvider>
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
  const [saveMode, setSaveMode] = useState<'instant' | 'step' | 'manual'>('instant');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const lastSavedDataRef = useRef<string>('');
  const lastSavedStepRef = useRef<string>('name');
  const isInitialLoadRef = useRef(true);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = loadFromStorage();
    if (saved) {
      const savedDataString = JSON.stringify(saved.data);
      setFormData(saved.data);
      setCurrentStep(saved.currentStep);
      setLastSaved(saved.timestamp);
      setRecovered(true);
      lastSavedDataRef.current = savedDataString;
      lastSavedStepRef.current = saved.currentStep;
    } else {
      // Initialize with empty data ref
      lastSavedDataRef.current = JSON.stringify(formData);
      lastSavedStepRef.current = currentStep;
    }
    // Small delay to ensure state is updated before enabling change detection
    setTimeout(() => {
      isInitialLoadRef.current = false;
    }, 0);
  }, []);

  // Save function
  const doSave = useCallback(() => {
    saveToStorage(formData, currentStep);
    setLastSaved(new Date().toISOString());
    setHasUnsavedChanges(false);
    lastSavedDataRef.current = JSON.stringify(formData);
    lastSavedStepRef.current = currentStep;
    console.log('💾 Saved:', { formData, currentStep, mode: saveMode });
  }, [formData, currentStep, saveMode]);

  // Mark as dirty when data or step changes (compare with last saved)
  useEffect(() => {
    if (isInitialLoadRef.current) return;

    const currentDataString = JSON.stringify(formData);
    const dataChanged = currentDataString !== lastSavedDataRef.current;
    const stepChanged = currentStep !== lastSavedStepRef.current;

    if (dataChanged || stepChanged) {
      setHasUnsavedChanges(true);
    }
  }, [formData, currentStep]);

  // Auto-save in INSTANT mode (debounced) - saves on data OR step changes
  useEffect(() => {
    if (saveMode !== 'instant') return;
    if (isInitialLoadRef.current) return;

    const currentDataString = JSON.stringify(formData);
    const dataChanged = currentDataString !== lastSavedDataRef.current;
    const stepChanged = currentStep !== lastSavedStepRef.current;

    if (!dataChanged && !stepChanged) return;

    console.log('⏱️ Instant mode: scheduling save in 500ms...');
    const timer = setTimeout(() => {
      console.log('⏱️ Instant mode: saving now!');
      doSave();
    }, 500);
    return () => clearTimeout(timer);
  }, [formData, currentStep, saveMode, doSave]);

  // Auto-save in STEP mode (on navigation only)
  useEffect(() => {
    if (saveMode !== 'step') return;
    if (isInitialLoadRef.current) return;

    const stepChanged = currentStep !== lastSavedStepRef.current;
    if (!stepChanged) return;

    console.log('📍 Step mode: saving on step change');
    doSave();
  }, [currentStep, saveMode, doSave]);

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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 py-12 px-4 transition-colors duration-200 relative">
      {/* Theme toggle positioned at top-right of screen */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            Simple Form Wizard
          </h1>
          <p className="text-gray-600 dark:text-gray-300">
            With automatic localStorage persistence
          </p>
        </div>

        {/* Save Status */}
        <div className="mb-6 flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
          <div className="flex items-center gap-2">
            {hasUnsavedChanges ? (
              <>
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                <span className="text-sm text-gray-600 dark:text-gray-300">Unsaved changes...</span>
              </>
            ) : lastSaved ? (
              <>
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  Saved at {new Date(lastSaved).toLocaleTimeString()}
                </span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 bg-gray-300 dark:bg-gray-600 rounded-full"></div>
                <span className="text-sm text-gray-600 dark:text-gray-300">No data saved</span>
              </>
            )}
          </div>

          {recovered && (
            <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-3 py-1 rounded-full">
              ✓ Recovered from localStorage
            </span>
          )}
        </div>

        {/* Progress Bar */}
        <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
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
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {isComplete ? '✓' : idx + 1}
                  </div>
                  <div className={`mt-2 text-sm dark:text-gray-300 ${isActive ? 'font-semibold' : ''}`}>
                    {label}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
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
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
          {currentStep === 'name' && (
            <NameStep data={formData} onNext={handleNext} onChange={setFormData} />
          )}
          {currentStep === 'email' && (
            <EmailStep data={formData} onNext={handleNext} onBack={handleBack} onChange={setFormData} />
          )}
          {currentStep === 'review' && (
            <ReviewStep data={formData} onBack={handleBack} onSubmit={handleSubmit} />
          )}
        </div>

        {/* Controls */}
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <h3 className="font-semibold dark:text-white mb-4">Persistence Controls</h3>

          {/* Save Mode */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Save Mode
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setSaveMode('instant')}
                className={`flex-1 py-2 px-4 rounded-lg border transition-colors ${
                  saveMode === 'instant'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-600'
                }`}
              >
                <div className="font-medium">Instant</div>
                <div className="text-xs opacity-80">Save as you type</div>
              </button>
              <button
                onClick={() => setSaveMode('step')}
                className={`flex-1 py-2 px-4 rounded-lg border transition-colors ${
                  saveMode === 'step'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-600'
                }`}
              >
                <div className="font-medium">On Step</div>
                <div className="text-xs opacity-80">Save when changing steps</div>
              </button>
              <button
                onClick={() => setSaveMode('manual')}
                className={`flex-1 py-2 px-4 rounded-lg border transition-colors ${
                  saveMode === 'manual'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-600'
                }`}
              >
                <div className="font-medium">Manual</div>
                <div className="text-xs opacity-80">Save manually only</div>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            {saveMode === 'manual' && (
              <button
                onClick={doSave}
                className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-colors"
              >
                💾 Save Now
              </button>
            )}
            <button
              onClick={handleReset}
              className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 transition-colors"
            >
              🗑️ Clear Storage
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
