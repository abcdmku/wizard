import { useState } from 'react';
import { useWizardActions, useCurrentStepData, useWizardSharedContext } from '@wizard/react';
import { PreferencesSchema, type Preferences as PreferencesType, type ValidationContext } from '../../wizard/types';

export function Preferences() {
  const { next, back } = useWizardActions();
  const currentData = useCurrentStepData() as PreferencesType | undefined;
  const context = useWizardSharedContext() as ValidationContext;
  
  const [formData, setFormData] = useState<PreferencesType>({
    newsletter: currentData?.newsletter || false,
    notifications: {
      email: currentData?.notifications?.email ?? true,
      sms: currentData?.notifications?.sms ?? false,
      push: currentData?.notifications?.push ?? false
    },
    theme: currentData?.theme || 'auto',
    language: currentData?.language || 'en'
  });

  const handleNotificationChange = (type: keyof PreferencesType['notifications'], value: boolean) => {
    setFormData(prev => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        [type]: value
      }
    }));
  };

  const handleNext = async () => {
    try {
      // Validate with Zod schema
      PreferencesSchema.parse(formData);
      await next({ data: formData });
    } catch (error) {
      console.error('Validation error:', error);
    }
  };

  const handleBack = async () => {
    await back();
  };

  return (
    <div className="space-y-6">
      <div className="bg-purple-50 border-l-4 border-purple-400 p-4">
        <h2 className="text-lg font-semibold mb-2">Preferences</h2>
        <p className="text-sm text-gray-700">
          Configure your notification preferences and display settings.
        </p>
      </div>

      <div className="space-y-6">
        {/* Newsletter Subscription */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={formData.newsletter}
              onChange={(e) => setFormData(prev => ({ ...prev, newsletter: e.target.checked }))}
              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-gray-700">
                Subscribe to Newsletter
              </span>
              <p className="text-xs text-gray-500">
                Receive weekly updates about new features and tips
              </p>
            </div>
          </label>
        </div>

        {/* Notification Preferences */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            Notification Channels
          </h3>
          <div className="space-y-3">
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={formData.notifications.email}
                onChange={(e) => handleNotificationChange('email', e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm text-gray-700">Email Notifications</span>
                <p className="text-xs text-gray-500">Important updates via email</p>
              </div>
            </label>

            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={formData.notifications.sms}
                onChange={(e) => handleNotificationChange('sms', e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm text-gray-700">SMS Notifications</span>
                <p className="text-xs text-gray-500">Critical alerts via text message</p>
              </div>
            </label>

            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={formData.notifications.push}
                onChange={(e) => handleNotificationChange('push', e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm text-gray-700">Push Notifications</span>
                <p className="text-xs text-gray-500">Browser/app notifications</p>
              </div>
            </label>
          </div>
        </div>

        {/* Display Settings */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Theme
            </label>
            <select
              value={formData.theme}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                theme: e.target.value as PreferencesType['theme'] 
              }))}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="auto">Auto (System)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Language
            </label>
            <select
              value={formData.language}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                language: e.target.value as PreferencesType['language'] 
              }))}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
        </div>
      </div>

      {context.validationErrors.preferences && (
        <div className="bg-red-50 border border-red-200 rounded p-3">
          <p className="text-sm text-red-700 font-medium">Validation Errors:</p>
          <ul className="mt-1 text-sm text-red-600 list-disc ml-5">
            {context.validationErrors.preferences.map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-blue-50 rounded p-4">
        <h4 className="text-sm font-semibold text-blue-800 mb-2">Info</h4>
        <p className="text-xs text-blue-700">
          All preferences use Zod enum validation to ensure only valid values are accepted.
          The schema automatically validates the structure of nested objects like notifications.
        </p>
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
          Continue
        </button>
      </div>
    </div>
  );
}