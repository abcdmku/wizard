import { useState } from 'react';
import { usePersonalInfoStep } from '../../wizard/config';
import { PersonalInfoSchema, type PersonalInfo as PersonalInfoType, type ValidationContext } from '../../wizard/types';

export function PersonalInfo() {
  const { next, data: currentData, context } = usePersonalInfoStep() as { next: (ctx?: any) => Promise<void>; data: PersonalInfoType | undefined; context: ValidationContext };
  
  const [formData, setFormData] = useState<PersonalInfoType>({
    firstName: currentData?.firstName || '',
    lastName: currentData?.lastName || '',
    email: currentData?.email || '',
    age: currentData?.age || 18
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validateField = (field: keyof PersonalInfoType, value: any) => {
    try {
      // Create a partial object to validate
      const testData = { ...formData, [field]: value };
      const result = PersonalInfoSchema.safeParse(testData);
      
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

  const handleChange = (field: keyof PersonalInfoType, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    validateField(field, value);
  };

  const handleNext = async () => {
    try {
      // Validate entire form before proceeding
      PersonalInfoSchema.parse(formData);
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

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border-l-4 border-blue-400 p-4">
        <h2 className="text-lg font-semibold mb-2">Personal Information</h2>
        <p className="text-sm text-gray-700">
          Enter your personal details. All fields are validated using Zod schemas.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            First Name *
          </label>
          <input
            type="text"
            value={formData.firstName}
            onChange={(e) => handleChange('firstName', e.target.value)}
            className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 ${
              fieldErrors.firstName 
                ? 'border-red-500 focus:ring-red-500' 
                : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="John"
          />
          {fieldErrors.firstName && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.firstName}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Last Name *
          </label>
          <input
            type="text"
            value={formData.lastName}
            onChange={(e) => handleChange('lastName', e.target.value)}
            className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 ${
              fieldErrors.lastName 
                ? 'border-red-500 focus:ring-red-500' 
                : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="Doe"
          />
          {fieldErrors.lastName && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.lastName}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email *
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => handleChange('email', e.target.value)}
            className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 ${
              fieldErrors.email 
                ? 'border-red-500 focus:ring-red-500' 
                : 'border-gray-300 focus:ring-blue-500'
            }`}
            placeholder="john.doe@example.com"
          />
          {fieldErrors.email && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.email}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Age *
          </label>
          <input
            type="number"
            value={formData.age}
            onChange={(e) => handleChange('age', parseInt(e.target.value) || 0)}
            min="1"
            max="120"
            className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 ${
              fieldErrors.age 
                ? 'border-red-500 focus:ring-red-500' 
                : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {fieldErrors.age && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.age}</p>
          )}
        </div>
      </div>

      {context.validationErrors.personalInfo && (
        <div className="bg-red-50 border border-red-200 rounded p-3">
          <p className="text-sm text-red-700 font-medium">Validation Errors:</p>
          <ul className="mt-1 text-sm text-red-600 list-disc ml-5">
            {context.validationErrors.personalInfo.map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-gray-50 rounded p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Validation Rules:</h4>
        <ul className="text-xs text-gray-600 space-y-1">
          <li>• First name: minimum 2 characters</li>
          <li>• Last name: minimum 2 characters</li>
          <li>• Email: valid email format</li>
          <li>• Age: between 18 and 120</li>
        </ul>
      </div>

      <div className="flex gap-4">
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