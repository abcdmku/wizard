import { WizardProvider } from "@wizard/react";
import { formWizard } from "./wizard/config";
import { WizardContainer } from "./components/WizardContainer";

function App() {
  return (
    <WizardProvider wizard={formWizard}>
      <WizardContainer />
    </WizardProvider>
  );
}

export default App;