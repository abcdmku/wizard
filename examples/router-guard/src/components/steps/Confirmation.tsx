import { useState } from 'react';
import { useConfirmationStep, useGuardWizard } from '../../wizard/config';
import type { ConfirmationData, GuardContext, SecureData } from '../../wizard/types';

export function Confirmation() {
  const { next, back, data: currentData, context } = useConfirmationStep() as { next: (ctx?: any) => Promise<void>; back: () => void; data: ConfirmationData | undefined; context: GuardContext };
  const { data } = useGuardWizard();

  const [confirmed, setConfirmed] = useState(currentData?.confirmed || false);
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (!confirmed) {
      setError('You must check the confirmation box to proceed');
      return;
    }

    setIsSubmitting(true);
    try {
      await next({ data: { confirmed, timestamp: currentData?.timestamp || new Date() } });
      // In a real app, this would submit to an API
      alert('✅ Order confirmed successfully! All steps are now locked.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to confirm');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = async () => {
    const proceed = window.confirm(
      'Warning: Going back will discard your confirmation. Are you sure?'
    );
    
    if (!proceed) return;
    
    try {
      await back();
    } catch (error) {
      // The canExit guard should prevent this
      alert('Cannot go back from confirmation step');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-purple-50 border-l-4 border-purple-400 p-4">
        <h2 className="text-lg font-semibold mb-2">🎉 Final Confirmation</h2>
        <p className="text-sm text-gray-700">
          Review all your settings before confirming. Once confirmed, you cannot modify any previous steps.
        </p>
        {currentData?.timestamp && (
          <p className="text-xs text-gray-600 mt-1">
            Started at: {new Date(currentData.timestamp).toLocaleString()}
          </p>
        )}
      </div>

      <div className="bg-gray-50 rounded-lg p-6 space-y-4">
        <h3 className="font-semibold text-gray-900">Summary of Your Configuration</h3>
        
        {/* Show data from all steps */}
        <div className="space-y-3">
          <div className="border-l-2 border-blue-300 pl-4">
            <h4 className="text-sm font-medium text-gray-700">Authentication</h4>
            <p className="text-sm text-gray-600">
              Logged in as: <strong>{context.userId}</strong>
            </p>
          </div>

          {(() => {
            const secureStepData = data?.secureData as SecureData | undefined;
            if (secureStepData && secureStepData.apiEndpoint) {
              return (
                <div className="border-l-2 border-green-300 pl-4">
                  <h4 className="text-sm font-medium text-gray-700">Secure Configuration</h4>
                  <p className="text-sm text-gray-600">
                    API Endpoint: <code className="bg-gray-200 px-1 rounded">{secureStepData.apiEndpoint}</code>
                  </p>
                  <p className="text-sm text-gray-600">
                    Encryption: {secureStepData.encryptionEnabled ? '✅ Enabled' : '❌ Disabled'}
                  </p>
                </div>
              );
            }
            return null;
          })()}

          <div className="border-l-2 border-purple-300 pl-4">
            <h4 className="text-sm font-medium text-gray-700">Status</h4>
            <p className="text-sm text-gray-600">
              Completed Steps: {context.completedSteps.join(', ') || 'None'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-red-50 border border-red-200 rounded p-4">
        <h4 className="text-sm font-semibold text-red-800 mb-2">⚠️ Important Notice</h4>
        <p className="text-xs text-red-700">
          After confirmation:
        </p>
        <ul className="text-xs text-red-700 mt-1 list-disc ml-4">
          <li>All previous steps will be locked</li>
          <li>You cannot go back to modify any settings</li>
          <li>The process will be finalized immediately</li>
        </ul>
      </div>

      <div className="bg-white border border-gray-200 rounded p-4">
        <label className="flex items-start space-x-3">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            disabled={isSubmitting}
          />
          <div>
            <span className="text-sm font-medium text-gray-700">
              I understand and confirm all settings
            </span>
            <p className="text-xs text-gray-500 mt-1">
              I acknowledge that this action cannot be undone
            </p>
          </div>
        </label>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex gap-4">
        <button
          onClick={handleBack}
          disabled={isSubmitting}
          className="flex-1 px-6 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Back
        </button>
        <button
          onClick={handleConfirm}
          disabled={isSubmitting || !confirmed}
          className={`flex-1 px-6 py-2 rounded text-white font-medium
            ${confirmed 
              ? 'bg-green-600 hover:bg-green-700' 
              : 'bg-gray-400 cursor-not-allowed'}
            ${isSubmitting ? 'opacity-50 cursor-wait' : ''}
          `}
        >
          {isSubmitting ? 'Confirming...' : 'Confirm & Finalize'}
        </button>
      </div>
    </div>
  );
}