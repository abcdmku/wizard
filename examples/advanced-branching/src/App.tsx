import { WizardProvider } from "@wizard/react";
import { branchingWizard } from "./wizard/config";
import { WizardContainer } from "./components/WizardContainer";
import { ThemeProvider } from "./hooks/useTheme";

function App() {
  return (
    <ThemeProvider>
      <WizardProvider wizard={branchingWizard}>
        <WizardContainer />
      </WizardProvider>
    </ThemeProvider>
  );
}

export default App;