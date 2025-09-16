import React from 'react';
import {
  useWizardStep,
  useWizardLoading,
  useWizardTransitioning,
} from '@wizard/react';
import { AccountStep } from './AccountStep';
import { ShippingStep } from './ShippingStep';
import { PaymentStep } from './PaymentStep';
import { ReviewStep } from './ReviewStep';
import { ProgressBar } from './ProgressBar';
import type { CheckoutContext, CheckoutSteps, CheckoutDataMap } from '../types';

export function CheckoutFlow() {
  const currentStep = useWizardStep<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  const isLoading = useWizardLoading<CheckoutContext, CheckoutSteps, CheckoutDataMap>();
  const isTransitioning = useWizardTransitioning<CheckoutContext, CheckoutSteps, CheckoutDataMap>();

  const renderStep = () => {
    switch (currentStep) {
      case 'account':
        return <AccountStep />;
      case 'shipping':
        return <ShippingStep />;
      case 'payment':
        return <PaymentStep />;
      case 'review':
        return <ReviewStep />;
      default:
        return null;
    }
  };

  return (
    <div>
      <ProgressBar />
      
      {(isLoading || isTransitioning) && (
        <div style={{ 
          padding: '1rem', 
          background: '#f0f0f0', 
          borderRadius: '4px',
          marginBottom: '1rem' 
        }}>
          {isLoading ? 'Loading...' : 'Transitioning...'}
        </div>
      )}

      <div style={{ 
        opacity: isTransitioning ? 0.5 : 1,
        transition: 'opacity 0.3s'
      }}>
        {renderStep()}
      </div>
    </div>
  );
}