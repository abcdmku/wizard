import { useState } from 'react';
import { 
  useWizardActions, 
  useCurrentStepData, 
  useWizardErrors,
  useWizardSharedContext 
} from '@wizard/react';
import type { CheckoutContext, CheckoutSteps, CheckoutDataMap } from '../types';

export function PaymentStep() {
  const { next, back, updateContext } = useWizardActions<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  const context = useWizardSharedContext<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  const existingData = useCurrentStepData<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  const errors = useWizardErrors<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  
  const data = existingData as { cardLast4: string; cardHolder: string } | undefined;
  const [cardLast4, setCardLast4] = useState(data?.cardLast4 || '');
  const [cardHolder, setCardHolder] = useState(data?.cardHolder || '');
  const [couponCode, setCouponCode] = useState(context.coupon || '');
  
  const stepError = errors.payment;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await next({ cardLast4, cardHolder });
    } catch (error) {
      console.error('Failed to proceed:', error);
    }
  };

  const applyCoupon = () => {
    if (couponCode) {
      updateContext((ctx) => {
        ctx.coupon = couponCode;
      });
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Payment Information</h2>
      
      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="cardLast4" style={{ display: 'block', marginBottom: '0.5rem' }}>
          Card Last 4 Digits
        </label>
        <input
          id="cardLast4"
          type="text"
          value={cardLast4}
          onChange={(e) => setCardLast4(e.target.value)}
          placeholder="1234"
          maxLength={4}
          style={{
            width: '100%',
            padding: '0.5rem',
            fontSize: '1rem',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
        />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="cardHolder" style={{ display: 'block', marginBottom: '0.5rem' }}>
          Card Holder Name
        </label>
        <input
          id="cardHolder"
          type="text"
          value={cardHolder}
          onChange={(e) => setCardHolder(e.target.value)}
          placeholder="John Doe"
          style={{
            width: '100%',
            padding: '0.5rem',
            fontSize: '1rem',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
        />
      </div>

      <div style={{ 
        marginBottom: '1rem', 
        padding: '1rem', 
        background: '#f5f5f5',
        borderRadius: '4px'
      }}>
        <label htmlFor="coupon" style={{ display: 'block', marginBottom: '0.5rem' }}>
          Coupon Code (Optional)
        </label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            id="coupon"
            type="text"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            placeholder="SAVE10"
            style={{
              flex: 1,
              padding: '0.5rem',
              fontSize: '1rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
            }}
          />
          <button
            type="button"
            onClick={applyCoupon}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '1rem',
              background: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Apply
          </button>
        </div>
        {context.coupon && (
          <div style={{ marginTop: '0.5rem', color: 'green' }}>
            Coupon "{context.coupon}" applied!
          </div>
        )}
      </div>

      {stepError ? (
        <div style={{ color: 'red', marginBottom: '1rem', fontSize: '0.9rem' }}>
          {typeof stepError === 'string' ? stepError : 'An error occurred'}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: '1rem' }}>
        <button
          type="button"
          onClick={() => back()}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '1rem',
            background: '#666',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Back
        </button>
        <button
          type="submit"
          style={{
            padding: '0.5rem 1rem',
            fontSize: '1rem',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Continue to Review
        </button>
      </div>
    </form>
  );
}