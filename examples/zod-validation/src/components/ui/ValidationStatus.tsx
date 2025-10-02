import { useValidationWizard } from '../../wizard/config';
import type { ValidationContext } from '../../wizard/types';

export function ValidationStatus() {
  const { context } = useValidationWizard() as { context: ValidationContext };
  
  const totalErrors = Object.values(context.validationErrors)
    .flat()
    .length;

  if (totalErrors === 0 && context.completedSteps.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Validation Status</h3>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center">
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full mb-2 ${
            totalErrors === 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
          }`}>
            {totalErrors === 0 ? '✓' : totalErrors}
          </div>
          <div className="text-xs font-medium text-gray-600">Validation Errors</div>
          <div className={`text-xs ${totalErrors === 0 ? 'text-green-600' : 'text-red-600'}`}>
            {totalErrors === 0 ? 'No errors' : `${totalErrors} error${totalErrors > 1 ? 's' : ''}`}
          </div>
        </div>

        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-2 bg-blue-100 text-blue-600">
            {context.completedSteps.length}
          </div>
          <div className="text-xs font-medium text-gray-600">Validated Steps</div>
          <div className="text-xs text-blue-600">
            {context.completedSteps.length} of 4
          </div>
        </div>

        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-2 bg-purple-100 text-purple-600">
            {context.attemptedSteps.length}
          </div>
          <div className="text-xs font-medium text-gray-600">Attempted</div>
          <div className="text-xs text-purple-600">
            {context.attemptedSteps.length} step{context.attemptedSteps.length !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="text-center">
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full mb-2 ${
            context.isValidating ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-400'
          }`}>
            {context.isValidating ? '⏳' : '⏸'}
          </div>
          <div className="text-xs font-medium text-gray-600">Status</div>
          <div className={`text-xs ${context.isValidating ? 'text-yellow-600' : 'text-gray-400'}`}>
            {context.isValidating ? 'Validating...' : 'Ready'}
          </div>
        </div>
      </div>

      {totalErrors > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-200">
          <p className="text-xs text-gray-500 mb-2">Active validation errors:</p>
          <div className="space-y-1">
            {Object.entries(context.validationErrors).map(([step, errors]) => (
              errors.length > 0 && (
                <div key={step} className="text-xs">
                  <span className="font-medium text-gray-700 capitalize">{step}:</span>
                  <span className="text-red-600 ml-1">
                    {errors.length} error{errors.length > 1 ? 's' : ''}
                  </span>
                </div>
              )
            ))}
          </div>
        </div>
      )}
    </div>
  );
}