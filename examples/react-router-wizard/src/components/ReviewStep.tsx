import React, { useState } from 'react';
import { 
  useWizardActions, 
  useWizardState,
  useWizardSharedContext,
  useStepData,
  useWizardErrors 
} from '@wizard/react';
import type { CheckoutContext, CheckoutSteps, CheckoutDataMap } from '../types';

export function ReviewStep() {
  const { back, reset } = useWizardActions<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  const context = useWizardSharedContext<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  const state = useWizardState<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  const errors = useWizardErrors<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  
  const accountData = useStepData<CheckoutContext, CheckoutSteps, CheckoutDataMap, 'account'>('account');
  const shippingData = useStepData<CheckoutContext, CheckoutSteps, CheckoutDataMap, 'shipping'>('shipping');
  const paymentData = useStepData<CheckoutContext, CheckoutSteps, CheckoutDataMap, 'payment'>('payment');
  
  const [agreed, setAgreed] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  
  const stepError = errors.review;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!agreed) {
      return;
    }

    // Simulate order submission
    console.log('Submitting order:', {
      context,
      data: state.data,
    });
    
    setIsSubmitted(true);
  };

  if (isSubmitted) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <h2 style={{ color: '#4CAF50' }}>Order Complete!</h2>
        <p>Thank you for your order. Total: ${context.total.toFixed(2)}</p>
        <button
          onClick={() => reset()}
          style={{
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            fontSize: '1rem',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Start New Order
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Review Your Order</h2>
      
      <div style={{ marginBottom: '1.5rem' }}>
        <h3>Account</h3>
        <p>Email: {accountData?.email}</p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <h3>Shipping</h3>
        <p>{shippingData?.address}</p>
        <p>{shippingData?.city}, {shippingData?.zipCode}</p>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <h3>Payment</h3>
        <p>Card ending in: {paymentData?.cardLast4}</p>
        <p>Card holder: {paymentData?.cardHolder}</p>
        {context.coupon && (
          <p style={{ color: 'green' }}>Coupon applied: {context.coupon}</p>
        )}
      </div>

      <div style={{ 
        marginBottom: '1.5rem',
        padding: '1rem',
        background: '#f5f5f5',
        borderRadius: '4px',
        fontSize: '1.2rem',
        fontWeight: 'bold'
      }}>
        Total: ${context.total.toFixed(2)}
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          I agree to the terms and conditions
        </label>
        {stepError && (
          <div style={{ color: 'red', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            {String(stepError)}
          </div>
        )}
      </div>

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
          disabled={!agreed}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '1rem',
            background: agreed ? '#4CAF50' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: agreed ? 'pointer' : 'not-allowed',
          }}
        >
          Complete Order
        </button>
      </div>
    </form>
  );
}