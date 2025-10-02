import type { FormData } from '../wizard/config';

interface Props {
  data: FormData;
  onBack: () => void;
  onSubmit: () => void;
}

export function ReviewStep({ data, onBack, onSubmit }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 dark:text-white">Review Your Information</h2>
        <p className="text-gray-600 dark:text-slate-400">Please confirm everything is correct</p>
      </div>

      <div className="bg-gray-50 dark:bg-slate-700/30 rounded-lg p-6 space-y-4">
        <div>
          <div className="text-sm text-gray-600 dark:text-slate-400">Name</div>
          <div className="text-lg font-medium dark:text-white">{data.name}</div>
        </div>

        <div>
          <div className="text-sm text-gray-600 dark:text-slate-400">Email</div>
          <div className="text-lg font-medium dark:text-white">{data.email}</div>
        </div>

        <div>
          <div className="text-sm text-gray-600 dark:text-slate-400">Age</div>
          <div className="text-lg font-medium dark:text-white">{data.age}</div>
        </div>

        <div>
          <div className="text-sm text-gray-600 dark:text-slate-400">Terms Accepted</div>
          <div className="text-lg font-medium dark:text-white">{data.terms ? '✓ Yes' : '✗ No'}</div>
        </div>
      </div>

      <div className="flex gap-4">
        <button
          onClick={onBack}
          className="flex-1 bg-gray-200 dark:bg-slate-700/50 text-gray-700 dark:text-slate-300 py-3 px-6 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onSubmit}
          className="flex-1 bg-green-600 text-white py-3 px-6 rounded-lg hover:bg-green-700 transition-colors"
        >
          Submit
        </button>
      </div>
    </div>
  );
}
