import { useResumeWizard } from '../../wizard/config';
import type { WizardContext } from '../../wizard/types';

export function AutoSaveIndicator() {
  const { context } = useResumeWizard() as { context: WizardContext };
  
  if (!context.autoSaveEnabled) return null;
  
  return (
    <div className="fixed top-4 right-4 bg-white shadow-lg rounded-lg p-3 min-w-[200px]">
      <div className="flex items-center gap-2">
        {context.isDirty ? (
          <>
            <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
            <span className="text-sm text-gray-600">Unsaved changes</span>
          </>
        ) : (
          <>
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="text-sm text-gray-600">All changes saved</span>
          </>
        )}
      </div>
      
      {context.lastAutoSave && (
        <div className="text-xs text-gray-500 mt-1">
          Last saved: {context.lastAutoSave.toLocaleTimeString()}
        </div>
      )}
      
      {context.recoveredFromStorage && (
        <div className="text-xs text-blue-600 mt-1">
          ✓ Recovered from previous session
        </div>
      )}
    </div>
  );
}