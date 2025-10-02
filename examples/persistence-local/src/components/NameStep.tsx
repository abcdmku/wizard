import { useState } from 'react';
import type { FormData } from '../wizard/config';

interface Props {
  data: FormData;
  onNext: (data: FormData) => void;
}

export function NameStep({ data, onNext }: Props) {
  const [name, setName] = useState(data.name);

  const handleNext = () => {
    onNext({ ...data, name });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">What's your name?</h2>
        <p className="text-gray-600">Enter your full name to get started</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Full Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="John Doe"
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          autoFocus
        />
      </div>

      <button
        onClick={handleNext}
        disabled={!name.trim()}
        className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        Continue
      </button>
    </div>
  );
}
