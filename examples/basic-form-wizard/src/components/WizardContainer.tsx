import { StepIndicator } from "./StepIndicator";
import { ThemeToggle } from "./ui/ThemeToggle";
import { FormWizard } from "../wizard/steps";
import { useCurrentStep } from "@wizard/react";

export function WizardContainer() {
  const { name, component } = useCurrentStep(FormWizard)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4 transition-colors duration-200 relative">
      {/* Theme toggle positioned at top-right of screen */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-xl p-6">
        {name !== "summary" && <StepIndicator />}
        <div className={name !== "summary" ? "mt-6" : ""}>{component}</div>
      </div>
    </div>
  );
} 