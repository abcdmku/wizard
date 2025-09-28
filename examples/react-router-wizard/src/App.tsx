import { WizardProvider } from '@wizard/react';
import { checkoutWizard } from './wizard';
import { CheckoutFlow } from './components/CheckoutFlow';

export function App() {
  return (
    <WizardProvider wizard={checkoutWizard}>
      <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
        <h1>Checkout Wizard Example</h1>
        <CheckoutFlow />
      </div>
    </WizardProvider>
  );
}