import { useEffect } from 'react';
import { useShippingStep, useCheckoutWizard, checkoutWizard } from '../wizard';
import { useNavigate } from '@tanstack/react-router';
import { FormField } from './ui/FormField';
import { Button } from './ui/Button';
import { ErrorMessage } from './ui/ErrorMessage';
import { formatError } from '../utils/formatError';

export function ShippingStep() {
  const { data, error, next, back, updateData } = useShippingStep();
  const { context } = useCheckoutWizard();
  const navigate = useNavigate();

  // Clear error when leaving the step
  useEffect(() => {
    return () => {
      checkoutWizard.clearStepError('shipping');
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await next();
      navigate({ to: '/checkout/payment' });
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const handleBack = () => {
    back();
    navigate({ to: '/checkout/account' });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <p className="text-gray-600 dark:text-gray-400 text-sm">
        Shipping for: {context.userId}
      </p>

      <FormField
        id="address"
        label="Street Address"
        type="text"
        value={data?.address || ''}
        onChange={(e) => updateData({ address: e.target.value })}
        placeholder="123 Main St"
      />

      <FormField
        id="city"
        label="City"
        type="text"
        value={data?.city || ''}
        onChange={(e) => updateData({ city: e.target.value })}
        placeholder="New York"
      />

      <FormField
        id="zipCode"
        label="ZIP Code"
        type="text"
        value={data?.zipCode || ''}
        onChange={(e) => updateData({ zipCode: e.target.value })}
        placeholder="10001"
      />

      {error != null && <ErrorMessage message={formatError(error)} />}

      <div className="flex gap-4">
        <Button type="button" onClick={handleBack} variant="secondary" fullWidth>
          Back
        </Button>
        <Button type="submit" variant="primary" fullWidth>
          Continue to Payment
        </Button>
      </div>
    </form>
  );
}
