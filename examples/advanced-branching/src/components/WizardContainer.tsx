import { useBranchingWizard } from "../wizard/config";
import { StepNavigator } from "./ui/StepNavigator";
import { RoleBadge } from "./ui/RoleBadge";
import { ThemeToggle } from "./ui/ThemeToggle";
import { RoleSelection } from "./steps/RoleSelection";
import { UserProfile } from "./steps/UserProfile";
import { AdminPanel } from "./steps/AdminPanel";
import { ManagerDashboard } from "./steps/ManagerDashboard";
import { SharedReview } from "./steps/SharedReview";
import { SendReminder } from "./steps/SendReminder";

export function WizardContainer() {
  const { step: currentStep, context } = useBranchingWizard();

  const renderStep = () => {
    switch (currentStep) {
      case "roleSelection":
        return <RoleSelection />;
      case "userProfile":
        return <UserProfile />;
      case "adminPanel":
        return <AdminPanel />;
      case "managerDashboard":
        return <ManagerDashboard />;
      case "sharedReview":
        return <SharedReview />;
      default:
        return <div className="dark:text-gray-200">Unknown step: {currentStep}</div>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 py-12 px-4 transition-colors duration-200">
      <div className="max-w-3xl mx-auto">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Advanced Branching Wizard
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Experience different paths based on your role selection
          </p>
          {context.role && (
            <div className="mt-3">
              <span className="text-gray-700 dark:text-gray-300">Current Role: </span>
              <RoleBadge role={context.role} />
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 transition-colors duration-200">
          <StepNavigator />
          <div className="mt-6">
            {renderStep()}
          </div>
        </div>

        <div className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
          This wizard demonstrates dynamic navigation based on role and choices
        </div>
      </div>
    </div>
  );
}