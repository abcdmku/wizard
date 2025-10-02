import { useState } from 'react';
import { useValidationWizard, useReviewStep } from '../../wizard/config';
import { ReviewSchema, type Review as ReviewType, type PersonalInfo, type Address, type Preferences } from '../../wizard/types';

export function Review() {
  const { next, back, setStepData, context, data } = useValidationWizard();
  const reviewStep = useReviewStep();
  const currentData = reviewStep.data;
  
  const [formData, setFormData] = useState<ReviewType>({
    agreeToTerms: currentData?.agreeToTerms || false,
    dataProcessing: currentData?.dataProcessing || false
  });

  const [validationError, setValidationError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setValidationError('');

    try {
      // Validate consent with Zod
      ReviewSchema.parse(formData);

      // Simulate API submission
      await new Promise(resolve => setTimeout(resolve, 1500));

      setStepData('review', formData);
      await next();

      // Show success message
      alert('✅ Registration completed successfully! All data has been validated with Zod schemas.');
    } catch (error: any) {
      if (error.errors) {
        const messages = error.errors.map((e: any) => e.message);
        setValidationError(messages.join('. '));
      } else {
        setValidationError(error.message || 'Please accept all terms to continue');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = async () => {
    await back();
  };

  // Type the step data
  const personalInfo = data?.personalInfo as PersonalInfo | undefined;
  const address = data?.address as Address | undefined;
  const preferences = data?.preferences as Preferences | undefined;

  return (
    <div className="space-y-6">
      <div className="bg-indigo-50 border-l-4 border-indigo-400 p-4">
        <h2 className="text-lg font-semibold mb-2">Review & Submit</h2>
        <p className="text-sm text-gray-700">
          Review your information and accept the terms to complete registration.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="space-y-4">
        {/* Personal Info Summary */}
        {personalInfo && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Personal Information</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-gray-500">Name:</dt>
              <dd className="text-gray-900">{personalInfo.firstName} {personalInfo.lastName}</dd>
              <dt className="text-gray-500">Email:</dt>
              <dd className="text-gray-900">{personalInfo.email}</dd>
              <dt className="text-gray-500">Age:</dt>
              <dd className="text-gray-900">{personalInfo.age} years</dd>
            </dl>
          </div>
        )}

        {/* Address Summary */}
        {address && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Address</h3>
            <p className="text-sm text-gray-900">
              {address.street}<br />
              {address.city}, {address.state} {address.zipCode}
            </p>
          </div>
        )}

        {/* Preferences Summary */}
        {preferences && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Preferences</h3>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Newsletter:</dt>
                <dd className="text-gray-900">{preferences.newsletter ? '✓ Subscribed' : '✗ Not subscribed'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Notifications:</dt>
                <dd className="text-gray-900">
                  {[
                    preferences.notifications.email && 'Email',
                    preferences.notifications.sms && 'SMS',
                    preferences.notifications.push && 'Push'
                  ].filter(Boolean).join(', ') || 'None'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Theme:</dt>
                <dd className="text-gray-900 capitalize">{preferences.theme}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Language:</dt>
                <dd className="text-gray-900 uppercase">{preferences.language}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {/* Consent Checkboxes */}
      <div className="space-y-3">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <label className="flex items-start space-x-3">
            <input
              type="checkbox"
              checked={formData.agreeToTerms}
              onChange={(e) => setFormData(prev => ({ ...prev, agreeToTerms: e.target.checked }))}
              disabled={isSubmitting}
              className="mt-1 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-gray-700">
                I agree to the Terms and Conditions *
              </span>
              <p className="text-xs text-gray-500 mt-1">
                By checking this box, you agree to our terms of service, privacy policy, and cookie policy.
              </p>
            </div>
          </label>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <label className="flex items-start space-x-3">
            <input
              type="checkbox"
              checked={formData.dataProcessing}
              onChange={(e) => setFormData(prev => ({ ...prev, dataProcessing: e.target.checked }))}
              disabled={isSubmitting}
              className="mt-1 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-gray-700">
                I consent to data processing *
              </span>
              <p className="text-xs text-gray-500 mt-1">
                I understand that my data will be processed according to the privacy policy.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Validation Error */}
      {(validationError || context.validationErrors.review) && (
        <div className="bg-red-50 border border-red-200 rounded p-3">
          <p className="text-sm text-red-700 font-medium">
            {validationError || 'Please fix the following errors:'}
          </p>
          {context.validationErrors.review && (
            <ul className="mt-1 text-sm text-red-600 list-disc ml-5">
              {context.validationErrors.review.map((error, idx) => (
                <li key={idx}>{error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Completed Steps */}
      <div className="bg-green-50 border border-green-200 rounded p-3">
        <p className="text-sm text-green-700">
          <strong>Completed Steps:</strong> {context.completedSteps.join(' → ') || 'None'}
        </p>
      </div>

      <div className="bg-gray-50 rounded p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Zod Validation Note:</h4>
        <p className="text-xs text-gray-600">
          Both checkboxes use Zod's <code className="bg-gray-200 px-1 rounded">.refine()</code> method
          to ensure they are checked before submission. This demonstrates custom validation rules
          beyond basic type checking.
        </p>
      </div>

      <div className="flex gap-4">
        <button
          onClick={handleBack}
          disabled={isSubmitting}
          className="flex-1 px-6 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          Back
        </button>
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || (!formData.agreeToTerms || !formData.dataProcessing)}
          className={`flex-1 px-6 py-2 rounded text-white font-medium transition-colors ${
            formData.agreeToTerms && formData.dataProcessing
              ? 'bg-green-600 hover:bg-green-700'
              : 'bg-gray-400 cursor-not-allowed'
          } ${isSubmitting ? 'opacity-50 cursor-wait' : ''}`}
        >
          {isSubmitting ? 'Submitting...' : 'Complete Registration'}
        </button>
      </div>
    </div>
  );
}