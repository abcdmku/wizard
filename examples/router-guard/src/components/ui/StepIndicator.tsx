import { useGuardWizard } from '../../wizard/config';
import type { GuardContext } from '../../wizard/types';

const steps = [
  { id: 'introduction', label: 'Welcome', icon: '👋', protected: false },
  { id: 'authentication', label: 'Login', icon: '🔐', protected: false },
  { id: 'secureData', label: 'Secure', icon: '🔒', protected: true },
  { id: 'confirmation', label: 'Confirm', icon: '✅', protected: true },
];

export function StepIndicator() {
  const { step, context } = useGuardWizard() as { step: string; context: GuardContext };
  const currentIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex justify-between items-center">
        {steps.map((stepInfo, index) => {
          const isActive = stepInfo.id === step;
          const isCompleted = context.completedSteps.includes(stepInfo.id);
          const isLocked = context.lockedSteps.includes(stepInfo.id);
          const isAccessible = !stepInfo.protected || context.isAuthenticated;

          return (
            <div key={stepInfo.id} className="flex-1 text-center">
              <div className="relative">
                {index > 0 && (
                  <div
                    className={`absolute top-5 -left-1/2 right-1/2 h-0.5 ${
                      index <= currentIndex
                        ? isLocked
                          ? 'bg-red-300'
                          : 'bg-green-500'
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
                        ? 'bg-blue-600 text-white ring-4 ring-blue-200'
                        : isLocked
                        ? 'bg-red-500 text-white'
                        : isCompleted
                        ? 'bg-green-500 text-white'
                        : isAccessible
                        ? 'bg-gray-200 text-gray-600'
                        : 'bg-gray-100 text-gray-400'
                    }
                  `}
                >
                  {isLocked ? '🔒' : isCompleted ? '✓' : stepInfo.icon}
                </div>

                <div className="mt-2">
                  <div
                    className={`text-xs ${
                      isActive ? 'font-bold text-blue-600' : 'text-gray-600'
                    }`}
                  >
                    {stepInfo.label}
                  </div>
                  {stepInfo.protected && !context.isAuthenticated && (
                    <div className="text-xs text-red-500 mt-1">Protected</div>
                  )}
                  {isLocked && (
                    <div className="text-xs text-red-500 mt-1">Locked</div>
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
            context.lockedSteps.length > 0 ? 'bg-red-500' : 'bg-blue-600'
          }`}
          style={{
            width: `${((currentIndex + 1) / steps.length) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}