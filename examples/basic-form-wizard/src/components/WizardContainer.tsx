import { useWizardStep } from "@wizard/react";
import { StepIndicator } from "./ui/StepIndicator";
import { ThemeToggle } from "./ui/ThemeToggle";
import { AccountStep } from "./steps/AccountStep";
import { PersonalStep } from "./steps/PersonalStep";
import { AddressStep } from "./steps/AddressStep";

export function WizardContainer() {
  const currentStep = useWizardStep();

  const renderStep = () => {
    switch (currentStep) {
      case "account":
        return <AccountStep />;
      case "personal":
        return <PersonalStep />;
      case "address":
        return <AddressStep />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4 transition-colors duration-200">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-xl p-6 relative">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="pr-12">
          <StepIndicator />
        </div>
        <div className="mt-6">{renderStep()}</div>
      </div>
    </div>
  );
}