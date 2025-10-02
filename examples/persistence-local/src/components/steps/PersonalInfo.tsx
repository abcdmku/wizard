import { useState, useEffect } from 'react';
import { usePersonalStep } from '../../wizard/config';
import type { WizardContext, PersonalInfo as PersonalInfoType } from '../../wizard/types';

export function PersonalInfo() {
  const { next, context } = usePersonalStep() as { next: (ctx?: Partial<WizardContext>) => void; context: WizardContext };
  
  const [formData, setFormData] = useState<PersonalInfoType>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    location: '',
    linkedin: '',
    github: '',
    portfolio: '',
    ...context.resumeData.personalInfo,
  });

  useEffect(() => {
    if (context.recoveredFromStorage && context.resumeData.personalInfo) {
      setFormData(context.resumeData.personalInfo);
    }
  }, [context.recoveredFromStorage, context.resumeData.personalInfo]);

  const handleChange = (field: keyof PersonalInfoType) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setFormData(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    next({
      resumeData: {
        ...context.resumeData,
        personalInfo: formData,
      },
      isDirty: true,
    });
  };

  const isValid = formData.firstName && formData.lastName && formData.email;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            First Name *
          </label>
          <input
            type="text"
            value={formData.firstName}
            onChange={handleChange('firstName')}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Last Name *
          </label>
          <input
            type="text"
            value={formData.lastName}
            onChange={handleChange('lastName')}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
            required
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Email *</label>
        <input
          type="email"
          value={formData.email}
          onChange={handleChange('email')}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Phone</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={handleChange('phone')}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Location</label>
          <input
            type="text"
            value={formData.location}
            onChange={handleChange('location')}
            placeholder="City, State"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">LinkedIn</label>
        <input
          type="url"
          value={formData.linkedin || ''}
          onChange={handleChange('linkedin')}
          placeholder="https://linkedin.com/in/yourprofile"
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">GitHub</label>
        <input
          type="url"
          value={formData.github || ''}
          onChange={handleChange('github')}
          placeholder="https://github.com/yourusername"
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
        />
      </div>

      <button
        type="submit"
        disabled={!isValid}
        className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
      >
        Continue to Work Experience
      </button>
    </form>
  );
}