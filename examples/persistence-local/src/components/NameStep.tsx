import type { FormData } from '../wizard/config';

interface Props {
  data: FormData;
  onNext: (data: FormData) => void;
  onChange?: (data: FormData) => void;
}

export function NameStep({ data, onNext, onChange }: Props) {
  const handleChange = (name: string) => {
    onChange?.({ ...data, name });
  };

  const handleNext = () => {
    onNext(data);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 dark:text-white">What's your name?</h2>
        <p className="text-gray-600 dark:text-slate-400">Enter your full name to get started</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
          Full Name
        </label>
        <input
          type="text"
          value={data.name}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="John Doe"
          className="w-full p-3 border border-gray-300 dark:border-slate-600 dark:bg-slate-700/50 dark:text-white dark:placeholder-slate-400 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
          autoFocus
        />
      </div>

      <button
        onClick={handleNext}
        disabled={!data.name.trim()}
        className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors"
      >
        Continue
      </button>
    </div>
  );
}
