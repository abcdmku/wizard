import { useState } from 'react';
import { useAddressStep } from '../../wizard/config';
import { AddressSchema, type Address as AddressType, type ValidationContext } from '../../wizard/types';

export function Address() {
  const { next, back, data: currentData, context } = useAddressStep() as { next: (ctx?: any) => Promise<void>; back: () => void; data: AddressType | undefined; context: ValidationContext };
  
  const [formData, setFormData] = useState<AddressType>({
    street: currentData?.street || '',
    city: currentData?.city || '',
    state: currentData?.state || '',
    zipCode: currentData?.zipCode || ''
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validateField = (field: keyof AddressType, value: string) => {
    try {
      // Create a partial object to validate
      const testData = { ...formData, [field]: value };
      const result = AddressSchema.safeParse(testData);
      
      if (!result.success) {
        const fieldError = result.error.flatten().fieldErrors[field];
        if (fieldError && fieldError.length > 0) {
          setFieldErrors(prev => ({
            ...prev,
            [field]: fieldError[0]
          }));
        }
      } else {
        setFieldErrors(prev => {
          const updated = { ...prev };
          delete updated[field];
          return updated;
        });
      }
    } catch (error: any) {
      console.error('Validation error:', error);
    }
  };

  const handleChange = (field: keyof AddressType, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Real-time validation
    if (field === 'state') {
      validateField(field, value.toUpperCase());
    } else {
      validateField(field, value);
    }
  };

  const handleNext = async () => {
    try {
      // Validate entire form before proceeding
      AddressSchema.parse(formData);
      await next({ data: formData });
    } catch (error: any) {
      if (error.errors) {
        const errors: Record<string, string> = {};
        error.errors.forEach((err: any) => {
          if (err.path?.length > 0) {
            errors[err.path[0]] = err.message;
          }
        });
        setFieldErrors(errors);
      }
    }
  };

  const handleBack = async () => {
    await back();
  };

  // US States for dropdown
  const states = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
  ];

  return (
    <div className="space-y-6">
      <div className="bg-green-50 border-l-4 border-green-400 p-4">
        <h2 className="text-lg font-semibold mb-2">Address Information</h2>
        <p className="text-sm text-gray-700">
          Enter your address details. ZIP code format is validated in real-time.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Street Address *
          </label>
          <input
            type="text"
            value={formData.street}
            onChange={(e) => handleChange('street', e.target.value)}
            className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 ${
              fieldErrors.street 
                ? 'border-red-500 focus:ring-red-500' 
                : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="123 Main Street"
          />
          {fieldErrors.street && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.street}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              City *
            </label>
            <input
              type="text"
              value={formData.city}
              onChange={(e) => handleChange('city', e.target.value)}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 ${
                fieldErrors.city 
                  ? 'border-red-500 focus:ring-red-500' 
                  : 'border-gray-300 focus:ring-blue-500'
              }`}
              placeholder="New York"
            />
            {fieldErrors.city && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.city}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              State *
            </label>
            <select
              value={formData.state}
              onChange={(e) => handleChange('state', e.target.value)}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 ${
                fieldErrors.state 
                  ? 'border-red-500 focus:ring-red-500' 
                  : 'border-gray-300 focus:ring-blue-500'
              }`}
            >
              <option value="">Select State</option>
              {states.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
            {fieldErrors.state && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.state}</p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            ZIP Code *
          </label>
          <input
            type="text"
            value={formData.zipCode}
            onChange={(e) => handleChange('zipCode', e.target.value)}
            maxLength={10}
            className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 ${
              fieldErrors.zipCode 
                ? 'border-red-500 focus:ring-red-500' 
                : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="12345 or 12345-6789"
          />
          {fieldErrors.zipCode && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.zipCode}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Format: 12345 or 12345-6789
          </p>
        </div>
      </div>

      {context.validationErrors.address && (
        <div className="bg-red-50 border border-red-200 rounded p-3">
          <p className="text-sm text-red-700 font-medium">Validation Errors:</p>
          <ul className="mt-1 text-sm text-red-600 list-disc ml-5">
            {context.validationErrors.address.map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-gray-50 rounded p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Validation Rules:</h4>
        <ul className="text-xs text-gray-600 space-y-1">
          <li>• Street: minimum 5 characters</li>
          <li>• City: minimum 2 characters</li>
          <li>• State: exactly 2 characters (US state code)</li>
          <li>• ZIP: 5 digits or 5+4 format (12345 or 12345-6789)</li>
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
          Continue
        </button>
      </div>
    </div>
  );
}