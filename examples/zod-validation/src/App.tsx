import { WizardProvider } from '@wizard/react';
import { wizard } from './wizard/config';
import { WizardContainer } from './components/WizardContainer';

function App() {
  return (
    <WizardProvider wizard={wizard}>
      <WizardContainer />
    </WizardProvider>
  );
}

export default App;