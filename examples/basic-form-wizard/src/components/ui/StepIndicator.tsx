import { useWizardStep } from "@wizard/react";

const STEPS = ["account", "personal", "address"] as const;
const STEP_LABELS = ["Account", "Personal", "Address"];

export function StepIndicator() {
  const currentStep = useWizardStep();
  const currentIndex = STEPS.indexOf(currentStep as typeof STEPS[number]);

  return (
    <div className="flex justify-between">
      {STEPS.map((step, index) => (
        <div key={step} className="flex items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              currentIndex === index
                ? "bg-blue-600 text-white"
                : currentIndex > index
                ? "bg-green-600 text-white"
                : "bg-gray-200 text-gray-600"
            }`}
          >
            {currentIndex > index ? "✓" : index + 1}
          </div>
          <span className="ml-2 text-sm font-medium text-gray-600">
            {STEP_LABELS[index]}
          </span>
          {index < STEPS.length - 1 && (
            <div
              className={`w-16 h-0.5 ml-2 ${
                currentIndex > index ? "bg-green-600" : "bg-gray-200"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}