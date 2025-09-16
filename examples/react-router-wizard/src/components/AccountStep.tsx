import React, { useState } from 'react';
import { useWizardActions, useCurrentStepData, useWizardErrors } from '@wizard/react';
import type { CheckoutContext, CheckoutSteps, CheckoutDataMap } from '../types';

export function AccountStep() {
  const { next } = useWizardActions<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  const existingData = useCurrentStepData<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  const errors = useWizardErrors<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  
  const [email, setEmail] = useState(existingData?.email || '');
  const stepError = errors.account;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await next({ email });
    } catch (error) {
      console.error('Failed to proceed:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Account Information</h2>
      
      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="email" style={{ display: 'block', marginBottom: '0.5rem' }}>
          Email Address
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          style={{
            width: '100%',
            padding: '0.5rem',
            fontSize: '1rem',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
        />
        {stepError && (
          <div style={{ color: 'red', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            {String(stepError)}
          </div>
        )}
      </div>

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
        Continue to Shipping
      </button>
    </form>
  );
}