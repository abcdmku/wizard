import { useWizardStep } from "@wizard/react";

const STEPS = ["account", "personal", "address"] as const;
const STEP_LABELS = ["Account", "Personal", "Address"];

export function StepIndicator() {
  const currentStep = useWizardStep();
  const currentIndex = STEPS.indexOf(currentStep as typeof STEPS[number]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between relative">
        {/* Background line */}
        <div className="absolute left-6 right-6 top-6 h-0.5 bg-gray-200" />

        {/* Progress line */}
        <div
          className="absolute left-6 top-6 h-0.5 bg-blue-600 transition-all duration-300 ease-in-out"
          style={{
            width: currentIndex === 0 ? '0%' :
                   currentIndex === 1 ? 'calc(50% - 24px)' :
                   'calc(100% - 48px)'
          }}
        />

        {STEPS.map((step, index) => (
          <div key={step} className="flex flex-col items-center relative z-10">
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all duration-200 ${
                currentIndex === index
                  ? "bg-blue-600 text-white border-blue-600 shadow-lg scale-110"
                  : currentIndex > index
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-400 border-gray-200"
              }`}
            >
              {currentIndex > index ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                index + 1
              )}
            </div>
            <span
              className={`mt-3 text-sm font-medium transition-colors duration-200 ${
                currentIndex === index
                  ? "text-blue-600"
                  : currentIndex > index
                  ? "text-gray-900"
                  : "text-gray-400"
              }`}
            >
              {STEP_LABELS[index]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}