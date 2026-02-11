import { useState, useEffect } from 'react';
import { useReviewStep, useCheckoutWizard, checkoutWizard } from '../wizard';
import { Button } from './ui/Button';
import { ErrorMessage } from './ui/ErrorMessage';
import { formatError } from '../utils/formatError';

export function ReviewStep() {
  const { data, error, back, updateData } = useReviewStep();
  const { context, reset } = useCheckoutWizard();

  const accountData = checkoutWizard.getStepData('account');
  const shippingData = checkoutWizard.getStepData('shipping');
  const paymentData = checkoutWizard.getStepData('payment');

  const [isSubmitted, setIsSubmitted] = useState(false);

  // Clear error when leaving the step
  useEffect(() => {
    return () => {
      checkoutWizard.clearStepError('review');
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!data?.agreed) {
      return;
    }

    // Simulate order submission
    console.log('Submitting order:', {
      context,
      accountData,
      shippingData,
      paymentData,
    });

    setIsSubmitted(true);
  };

  const handleReset = () => {
    reset();
    // Navigation happens automatically via wizard route sync when reset changes the step
  };

  if (isSubmitted) {
    return (
      <div className="text-center space-y-6 py-8">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold text-green-600 dark:text-green-400">Order Complete!</h2>
          <p className="text-gray-700 dark:text-gray-300">
            Thank you for your order. Total: ${context.total.toFixed(2)}
          </p>
        </div>
        <Button onClick={handleReset} variant="primary">
          Start New Order
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Account</h3>
          <p className="text-gray-700 dark:text-gray-300">Email: {accountData?.email}</p>
        </div>

        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Shipping</h3>
          <p className="text-gray-700 dark:text-gray-300">{shippingData?.address}</p>
          <p className="text-gray-700 dark:text-gray-300">{shippingData?.city}, {shippingData?.zipCode}</p>
        </div>

        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Payment</h3>
          <p className="text-gray-700 dark:text-gray-300">Card ending in: {paymentData?.cardLast4}</p>
          <p className="text-gray-700 dark:text-gray-300">Card holder: {paymentData?.cardHolder}</p>
          {context.coupon && (
            <p className="text-green-600 dark:text-green-400 mt-1">Coupon applied: {context.coupon}</p>
          )}
        </div>

        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Total: ${context.total.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={data?.agreed || false}
            onChange={(e) => updateData({ agreed: e.target.checked })}
            className="w-4 h-4 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            I agree to the terms and conditions
          </span>
        </label>
        {error != null && <ErrorMessage message={formatError(error)} />}
      </div>

      <div className="flex gap-4">
        <Button type="button" onClick={back} variant="secondary" fullWidth>
          Back
        </Button>
        <Button
          type="submit"
          disabled={!data?.agreed}
          variant="success"
          fullWidth
        >
          Complete Order
        </Button>
      </div>
    </form>
  );
}
