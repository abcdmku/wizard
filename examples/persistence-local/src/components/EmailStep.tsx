import { useState } from 'react';
import type { FormData } from '../wizard/config';

interface Props {
  data: FormData;
  onNext: (data: FormData) => void;
  onBack: () => void;
}

export function EmailStep({ data, onNext, onBack }: Props) {
  const [email, setEmail] = useState(data.email);
  const [age, setAge] = useState(data.age);
  const [terms, setTerms] = useState(data.terms);

  const handleNext = () => {
    onNext({ ...data, email, age, terms });
  };

  const isValid = email.includes('@') && parseInt(age) >= 18 && terms;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Contact Information</h2>
        <p className="text-gray-600">We'll need a few more details</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Email Address
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="john@example.com"
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Age
        </label>
        <input
          type="number"
          value={age}
          onChange={(e) => setAge(e.target.value)}
          placeholder="18"
          min="18"
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <div className="flex items-start">
        <input
          type="checkbox"
          checked={terms}
          onChange={(e) => setTerms(e.target.checked)}
          className="mt-1 h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
        />
        <label className="ml-2 text-sm text-gray-700">
          I agree to the terms and conditions
        </label>
      </div>

      <div className="flex gap-4">
        <button
          onClick={onBack}
          className="flex-1 bg-gray-200 text-gray-700 py-3 px-6 rounded-lg hover:bg-gray-300 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          disabled={!isValid}
          className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          Review
        </button>
      </div>
    </div>
  );
}
