import { useCheckoutWizard } from '../wizard';
import type { CheckoutSteps } from '../types';

const steps: { id: CheckoutSteps; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'shipping', label: 'Shipping' },
  { id: 'payment', label: 'Payment' },
  { id: 'review', label: 'Review' },
];

export function ProgressBar() {
  const { step: currentStep } = useCheckoutWizard();

  const currentIndex = steps.findIndex(s => s.id === currentStep);

  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
        {steps.map((step, index) => (
          <div
            key={step.id}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '0.5rem',
              background: index <= currentIndex ? '#4CAF50' : '#e0e0e0',
              color: index <= currentIndex ? 'white' : '#666',
              borderRadius: '4px',
              margin: '0 2px',
              fontWeight: step.id === currentStep ? 'bold' : 'normal',
            }}
          >
            {step.label}
          </div>
        ))}
      </div>
      <div style={{ fontSize: '0.9rem', color: '#666' }}>
        Step {currentIndex + 1} of {steps.length}
      </div>
    </div>
  );
}
