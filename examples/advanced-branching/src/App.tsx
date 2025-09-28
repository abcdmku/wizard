import { WizardProvider } from "@wizard/react";
import { branchingWizard } from "./wizard/config";
import { WizardContainer } from "./components/WizardContainer";

function App() {
  return (
    <WizardProvider wizard={branchingWizard}>
      <WizardContainer />
    </WizardProvider>
  );
}

export default App;