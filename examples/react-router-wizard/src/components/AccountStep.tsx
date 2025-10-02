import { useEffect } from 'react';
import { useAccountStep, checkoutWizard } from '../wizard';
import { useNavigate } from '@tanstack/react-router';
import { FormField } from './ui/FormField';
import { Button } from './ui/Button';
import { ErrorMessage } from './ui/ErrorMessage';
import { formatError } from '../utils/formatError';

export function AccountStep() {
  const { data, error, next, updateData } = useAccountStep();
  const navigate = useNavigate();

  // Clear error when leaving the step
  useEffect(() => {
    return () => {
      checkoutWizard.clearStepError('account');
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await next();
      navigate({ to: '/checkout/shipping' });
    } catch (error) {
      // Validation error will be shown via the error state
      console.error('Validation failed:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormField
        id="email"
        label="Email Address"
        type="email"
        value={data?.email || ''}
        onChange={(e) => updateData({ email: e.target.value })}
        placeholder="your@email.com"
        required
      />

      {error != null && <ErrorMessage message={formatError(error)} />}

      <Button type="submit" variant="primary" fullWidth>
        Continue to Shipping
      </Button>
    </form>
  );
}
