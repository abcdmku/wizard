import { useWizardState } from '@wizard/react';

const steps = [
  { id: 'personal', label: 'Personal', icon: '👤' },
  { id: 'experience', label: 'Experience', icon: '💼' },
  { id: 'education', label: 'Education', icon: '🎓' },
  { id: 'skills', label: 'Skills', icon: '⚡' },
  { id: 'projects', label: 'Projects', icon: '🚀' },
  { id: 'summary', label: 'Summary', icon: '📝' },
  { id: 'preview', label: 'Preview', icon: '👁️' },
];

export function StepProgress() {
  const { step } = useWizardState();
  const currentIndex = steps.findIndex(s => s.id === step);
  
  return (
    <div className="mb-8">
      <div className="flex justify-between items-center">
        {steps.map((stepInfo, index) => {
          const isActive = stepInfo.id === step;
          const isCompleted = index < currentIndex;
          
          return (
            <div key={stepInfo.id} className="flex-1 text-center">
              <div className="relative">
                {index > 0 && (
                  <div
                    className={`absolute top-5 -left-1/2 right-1/2 h-0.5 ${
                      isCompleted ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  />
                )}
                
                <div
                  className={`
                    mx-auto w-10 h-10 rounded-full flex items-center justify-center
                    ${isActive ? 'bg-blue-600 text-white' : 
                      isCompleted ? 'bg-green-500 text-white' : 
                      'bg-gray-200 text-gray-500'}
                  `}
                >
                  {isCompleted ? '✓' : stepInfo.icon}
                </div>
                
                <div className="mt-2">
                  <div className={`text-xs ${isActive ? 'font-semibold' : ''}`}>
                    {stepInfo.label}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="mt-4 bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${((currentIndex + 1) / steps.length) * 100}%` }}
        />
      </div>
    </div>
  );
}