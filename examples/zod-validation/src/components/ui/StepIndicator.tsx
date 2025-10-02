import { useValidationWizard } from '../../wizard/config';

const steps = [
  { id: 'personalInfo', label: 'Personal', icon: '👤' },
  { id: 'address', label: 'Address', icon: '🏠' },
  { id: 'preferences', label: 'Preferences', icon: '⚙️' },
  { id: 'review', label: 'Review', icon: '✅' }
];

export function StepIndicator() {
  const { step, context } = useValidationWizard();
  const currentIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex justify-between items-center">
        {steps.map((stepInfo, index) => {
          const isActive = stepInfo.id === step;
          const isCompleted = context.completedSteps.includes(stepInfo.id);
          const hasErrors = context.validationErrors[stepInfo.id]?.length > 0;

          return (
            <div key={stepInfo.id} className="flex-1 text-center">
              <div className="relative">
                {index > 0 && (
                  <div
                    className={`absolute top-5 -left-1/2 right-1/2 h-0.5 ${
                      index <= currentIndex
                        ? hasErrors
                          ? 'bg-red-300'
                          : isCompleted
                          ? 'bg-green-500'
                          : 'bg-blue-500'
                        : 'bg-gray-300'
                    }`}
                  />
                )}

                <div
                  className={`
                    mx-auto w-10 h-10 rounded-full flex items-center justify-center
                    transition-all duration-200
                    ${
                      isActive
                        ? hasErrors
                          ? 'bg-red-600 text-white ring-4 ring-red-200'
                          : 'bg-blue-600 text-white ring-4 ring-blue-200'
                        : hasErrors
                        ? 'bg-red-500 text-white'
                        : isCompleted
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 text-gray-600'
                    }
                  `}
                >
                  {hasErrors ? '⚠️' : isCompleted ? '✓' : stepInfo.icon}
                </div>

                <div className="mt-2">
                  <div
                    className={`text-xs ${
                      isActive ? 'font-bold text-blue-600' : 'text-gray-600'
                    }`}
                  >
                    {stepInfo.label}
                  </div>
                  {hasErrors && (
                    <div className="text-xs text-red-500 mt-1">Has errors</div>
                  )}
                  {isCompleted && !hasErrors && (
                    <div className="text-xs text-green-500 mt-1">Validated</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${
            Object.keys(context.validationErrors).length > 0 ? 'bg-red-500' : 'bg-blue-600'
          }`}
          style={{
            width: `${((currentIndex + 1) / steps.length) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}