import { WizardProvider } from "@wizard/react";
import { ThemeProvider } from "./hooks/useTheme";
import { FormWizard } from "./wizard/steps";
import { WizardContainer } from "./components/WizardContainer";

function App() {
  return (
    <ThemeProvider>
      <WizardProvider wizard={FormWizard}>
        <WizardContainer />
      </WizardProvider>
    </ThemeProvider>
  );
}

export default App;