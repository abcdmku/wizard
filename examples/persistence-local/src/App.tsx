import { WizardProvider } from '@wizard/react';
import { resumeWizard } from './wizard/config';
import { WizardContainer } from './components/WizardContainer';

function App() {
  return (
    <WizardProvider wizard={resumeWizard}>
      <WizardContainer />
    </WizardProvider>
  );
}

export default App;