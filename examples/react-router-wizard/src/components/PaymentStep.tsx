import { useState, useEffect } from 'react';
import { usePaymentStep, useCheckoutWizard, checkoutWizard } from '../wizard';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { FormField } from './ui/FormField';
import { Button } from './ui/Button';
import { ErrorMessage } from './ui/ErrorMessage';
import { formatError } from '../utils/formatError';

export function PaymentStep() {
  const { data, error, next, updateData } = usePaymentStep();
  const { context, updateContext } = useCheckoutWizard();
  const navigate = useNavigate();
  const router = useRouter();
  const [couponInput, setCouponInput] = useState(context.coupon || '');

  // Clear error when leaving the step
  useEffect(() => {
    return () => {
      checkoutWizard.clearStepError('payment');
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await next();
      navigate({ to: '/checkout/review' });
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const handleBack = () => {
    // Use browser back button for true history navigation
    router.history.back();
  };

  const applyCoupon = () => {
    if (couponInput) {
      updateContext((ctx) => {
        ctx.coupon = couponInput;
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormField
        id="cardLast4"
        label="Card Last 4 Digits"
        type="text"
        value={data?.cardLast4 || ''}
        onChange={(e) => updateData({ cardLast4: e.target.value })}
        placeholder="1234"
        maxLength={4}
      />

      <FormField
        id="cardHolder"
        label="Card Holder Name"
        type="text"
        value={data?.cardHolder || ''}
        onChange={(e) => updateData({ cardHolder: e.target.value })}
        placeholder="John Doe"
      />

      <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
        <label htmlFor="coupon" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Coupon Code (Optional)
        </label>
        <div className="flex gap-2">
          <input
            id="coupon"
            type="text"
            value={couponInput}
            onChange={(e) => setCouponInput(e.target.value)}
            placeholder="SAVE10"
            className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          />
          <Button type="button" onClick={applyCoupon} variant="primary">
            Apply
          </Button>
        </div>
        {context.coupon && (
          <div className="text-sm text-green-600 dark:text-green-400">
            Coupon "{context.coupon}" applied!
          </div>
        )}
      </div>

      {error != null && <ErrorMessage message={formatError(error)} />}

      <div className="flex gap-4">
        <Button type="button" onClick={handleBack} variant="secondary" fullWidth>
          Back
        </Button>
        <Button type="submit" variant="primary" fullWidth>
          Continue to Review
        </Button>
      </div>
    </form>
  );
}
