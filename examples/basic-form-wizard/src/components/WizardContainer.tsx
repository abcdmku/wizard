import { useWizardStep } from "@wizard/react";
import { StepIndicator } from "./ui/StepIndicator";
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-md p-6">
        <StepIndicator />
        <div className="mt-6">{renderStep()}</div>
      </div>
    </div>
  );
}