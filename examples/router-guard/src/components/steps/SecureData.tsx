import { useState } from 'react';
import { useWizardActions, useCurrentStepData, useWizardSharedContext } from '@wizard/react';
import type { SecureData as SecureDataType, GuardContext } from '../../wizard/types';

export function SecureData() {
  const { next, back } = useWizardActions();
  const currentData = useCurrentStepData() as SecureDataType | undefined;
  const context = useWizardSharedContext() as GuardContext;

  const [formData, setFormData] = useState<SecureDataType>({
    secretKey: currentData?.secretKey || '',
    apiEndpoint: currentData?.apiEndpoint || '',
    encryptionEnabled: currentData?.encryptionEnabled || false,
  });

  const [error, setError] = useState<string>('');

  const handleNext = async () => {
    try {
      await next({ data: formData });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to proceed');
    }
  };

  const handleBack = async () => {
    try {
      await back();
    } catch (error) {
      console.error('Failed to go back:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-green-50 border-l-4 border-green-400 p-4">
        <h2 className="text-lg font-semibold mb-2">🔒 Secure Configuration</h2>
        <p className="text-sm text-gray-700">
          You've successfully accessed the secure area! Configure your secure settings below.
        </p>
        <p className="text-xs text-gray-600 mt-1">
          Authenticated as: <strong>{context.userId}</strong>
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Secret Key *
          </label>
          <input
            type="password"
            value={formData.secretKey}
            onChange={(e) => setFormData({ ...formData, secretKey: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your secret key"
          />
          <p className="text-xs text-gray-500 mt-1">
            This key will be used for secure operations
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            API Endpoint *
          </label>
          <input
            type="url"
            value={formData.apiEndpoint}
            onChange={(e) => setFormData({ ...formData, apiEndpoint: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="https://api.example.com"
          />
          <p className="text-xs text-gray-500 mt-1">
            Must be a secure HTTPS endpoint
          </p>
        </div>

        <div className="bg-gray-50 rounded p-4">
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={formData.encryptionEnabled}
              onChange={(e) => setFormData({ ...formData, encryptionEnabled: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-gray-700">
                Enable End-to-End Encryption
              </span>
              <p className="text-xs text-gray-500">
                All data will be encrypted before transmission
              </p>
            </div>
          </label>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      {context.hasUnsavedChanges && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
          <p className="text-sm text-yellow-700">
            ⚠️ You have unsaved changes. They will be lost if you navigate away.
          </p>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded p-4">
        <h4 className="text-sm font-semibold text-blue-800 mb-2">Security Notice</h4>
        <ul className="text-xs text-blue-700 space-y-1">
          <li>• This step is protected by authentication guards</li>
          <li>• Unsaved changes will trigger a warning when navigating away</li>
          <li>• After confirmation, all steps will be locked</li>
        </ul>
      </div>

      <div className="flex gap-4">
        <button
          onClick={handleBack}
          className="flex-1 px-6 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          className="flex-1 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Continue to Confirmation
        </button>
      </div>
    </div>
  );
}