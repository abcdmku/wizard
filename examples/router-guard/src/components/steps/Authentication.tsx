import { useState } from 'react';
import { useAuthenticationStep } from '../../wizard/config';
import type { AuthenticationData } from '../../wizard/types';

export function Authentication() {
  const { next, back, data: currentData, context, setStepData } = useAuthenticationStep();

  const [formData, setFormData] = useState<AuthenticationData>({
    username: currentData?.username || '',
    password: currentData?.password || '',
    verified: currentData?.verified || false,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string>('');

  const handleVerify = () => {
    // Simple verification logic
    if (formData.username === 'admin' && formData.password === 'password123') {
      setFormData({ ...formData, verified: true });
      setError('');
    } else {
      setError('Invalid credentials. Try: admin/password123');
      setFormData({ ...formData, verified: false });
    }
  };

  const handleNext = async () => {
    try {
      setStepData('authentication', formData);
      await next();
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
      <div className="bg-blue-50 border-l-4 border-blue-400 p-4">
        <h2 className="text-lg font-semibold mb-2">Authentication Required</h2>
        <p className="text-sm text-gray-700">
          Enter your credentials to access secure areas of the wizard.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Username
          </label>
          <input
            type="text"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter username"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Password
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
              placeholder="Enter password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-2 text-gray-500 hover:text-gray-700"
            >
              {showPassword ? '👁️' : '👁️‍🗨️'}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleVerify}
          className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
        >
          Verify Credentials
        </button>

        {formData.verified && (
          <div className="bg-green-50 border border-green-200 rounded p-3">
            <p className="text-sm text-green-700">
              ✅ Credentials verified successfully!
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      {!formData.verified && formData.username && formData.password && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
          <p className="text-sm text-yellow-700">
            ⚠️ If you proceed without verifying, you'll see an exit guard warning
          </p>
        </div>
      )}

      {context.hasUnsavedChanges && (
        <div className="bg-orange-50 border border-orange-200 rounded p-3">
          <p className="text-sm text-orange-700">
            📝 You have unsaved changes
          </p>
        </div>
      )}

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
          Continue
        </button>
      </div>
    </div>
  );
}