import { WizardProvider } from "@wizard/react";
import { ThemeProvider } from "./hooks/useTheme";
import { formWizard } from "./wizard/steps";
import { WizardContainer } from "./components/WizardContainer";

function App() {
  return (
    <ThemeProvider>
      <WizardProvider wizard={formWizard}>
        <WizardContainer />
      </WizardProvider>
    </ThemeProvider>
  );
}

export default App;