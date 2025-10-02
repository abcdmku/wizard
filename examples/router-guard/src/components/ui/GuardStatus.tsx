import { useGuardWizard } from '../../wizard/config';
import type { GuardContext } from '../../wizard/types';

export function GuardStatus() {
  const { context } = useGuardWizard() as { context: GuardContext };

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Guard Status</h3>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center">
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full mb-2 ${
            context.isAuthenticated ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
          }`}>
            {context.isAuthenticated ? '✓' : '🔒'}
          </div>
          <div className="text-xs font-medium text-gray-600">Authentication</div>
          <div className={`text-xs ${context.isAuthenticated ? 'text-green-600' : 'text-gray-400'}`}>
            {context.isAuthenticated ? 'Authenticated' : 'Not Authenticated'}
          </div>
        </div>

        <div className="text-center">
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full mb-2 ${
            context.hasUnsavedChanges ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-400'
          }`}>
            {context.hasUnsavedChanges ? '⚠️' : '✓'}
          </div>
          <div className="text-xs font-medium text-gray-600">Changes</div>
          <div className={`text-xs ${context.hasUnsavedChanges ? 'text-yellow-600' : 'text-gray-400'}`}>
            {context.hasUnsavedChanges ? 'Unsaved' : 'Saved'}
          </div>
        </div>

        <div className="text-center">
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full mb-2 ${
            context.lockedSteps.length > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'
          }`}>
            {context.lockedSteps.length}
          </div>
          <div className="text-xs font-medium text-gray-600">Locked Steps</div>
          <div className={`text-xs ${context.lockedSteps.length > 0 ? 'text-red-600' : 'text-gray-400'}`}>
            {context.lockedSteps.length > 0 ? context.lockedSteps.join(', ') : 'None'}
          </div>
        </div>

        <div className="text-center">
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full mb-2 ${
            context.completedSteps.length > 0 ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
          }`}>
            {context.completedSteps.length}
          </div>
          <div className="text-xs font-medium text-gray-600">Completed</div>
          <div className={`text-xs ${context.completedSteps.length > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
            {context.completedSteps.length > 0 ? `${context.completedSteps.length} steps` : 'None'}
          </div>
        </div>
      </div>

      {context.userId && (
        <div className="mt-4 pt-3 border-t border-gray-200">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Logged in as:</span>
            <span className="font-medium text-gray-700">{context.userId}</span>
          </div>
        </div>
      )}
    </div>
  );
}