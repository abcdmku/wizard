import { useState } from 'react';
import { useIntroductionStep } from '../../wizard/config';
import type { IntroductionData } from '../../wizard/types';

export function Introduction() {
  const { next, data: currentData } = useIntroductionStep() as { next: (ctx?: any) => Promise<void>; data: IntroductionData };
  
  const [agreed, setAgreed] = useState(currentData?.agreed || false);

  const handleNext = async () => {
    try {
      await next({ data: { agreed } });
    } catch (error) {
      console.error('Failed to proceed:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border-l-4 border-blue-400 p-4">
        <h2 className="text-lg font-semibold mb-2">Navigation Guards Demo</h2>
        <p className="text-sm text-gray-700">
          This wizard demonstrates various navigation guards:
        </p>
        <ul className="mt-2 text-sm text-gray-600 list-disc ml-5">
          <li>Exit guards that warn about unsaved changes</li>
          <li>Enter guards that check authentication</li>
          <li>Step locking after confirmation</li>
          <li>Browser back button prevention</li>
        </ul>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
        <h3 className="font-medium mb-2">Terms and Conditions</h3>
        <p className="text-sm text-gray-600 mb-4">
          By proceeding, you agree to our terms of service and privacy policy.
          This wizard will demonstrate various security features and access controls.
        </p>
        
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm">
            I agree to the terms and conditions
          </span>
        </label>
      </div>

      {!agreed && (
        <div className="bg-red-50 border border-red-200 rounded p-3">
          <p className="text-sm text-red-700">
            ⚠️ If you try to proceed without agreeing, you'll see an exit guard warning
          </p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleNext}
          className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Continue
        </button>
      </div>
    </div>
  );
}