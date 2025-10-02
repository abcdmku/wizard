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
        <h2 className="text-2xl font-bold mb-2">Review Your Information</h2>
        <p className="text-gray-600">Please confirm everything is correct</p>
      </div>

      <div className="bg-gray-50 rounded-lg p-6 space-y-4">
        <div>
          <div className="text-sm text-gray-600">Name</div>
          <div className="text-lg font-medium">{data.name}</div>
        </div>

        <div>
          <div className="text-sm text-gray-600">Email</div>
          <div className="text-lg font-medium">{data.email}</div>
        </div>

        <div>
          <div className="text-sm text-gray-600">Age</div>
          <div className="text-lg font-medium">{data.age}</div>
        </div>

        <div>
          <div className="text-sm text-gray-600">Terms Accepted</div>
          <div className="text-lg font-medium">{data.terms ? '✓ Yes' : '✗ No'}</div>
        </div>
      </div>

      <div className="flex gap-4">
        <button
          onClick={onBack}
          className="flex-1 bg-gray-200 text-gray-700 py-3 px-6 rounded-lg hover:bg-gray-300 transition-colors"
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
