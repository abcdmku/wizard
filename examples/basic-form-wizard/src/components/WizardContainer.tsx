import { useStore } from "@tanstack/react-store";
import { StepIndicator } from "./StepIndicator";
import { ThemeToggle } from "./ui/ThemeToggle";
import { AccountStep } from "./steps/AccountStep";
import { PersonalStep } from "./steps/PersonalStep";
import { AddressStep } from "./steps/AddressStep";
import { SummaryStep } from "./steps/SummaryStep";
import { FormWizard } from "../wizard/steps";

export function WizardContainer() {
  const state = useStore(FormWizard.store);
  const name = state.step;

  const renderStep = () => {
    switch (name) {
      case "account":
        return <AccountStep />;
      case "personal":
        return <PersonalStep />;
      case "address":
        return <AddressStep />;
      case "summary":
        return <SummaryStep />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4 transition-colors duration-200 relative">
      {/* Theme toggle positioned at top-right of screen */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-xl p-6">
        {name !== "summary" && <StepIndicator />}
        <div className={name !== "summary" ? "mt-6" : ""}>{renderStep()}</div>
      </div>
    </div>
  );
}