import { useWizardStep, useWizardSharedContext } from "@wizard/react";
import type { WizardContext } from "../wizard/types";
import { StepNavigator } from "./ui/StepNavigator";
import { RoleBadge } from "./ui/RoleBadge";
import { RoleSelection } from "./steps/RoleSelection";
import { UserProfile } from "./steps/UserProfile";
import { AdminPanel } from "./steps/AdminPanel";
import { ManagerDashboard } from "./steps/ManagerDashboard";
import { SharedReview } from "./steps/SharedReview";

export function WizardContainer() {
  const currentStep = useWizardStep();
  const context = useWizardSharedContext() as WizardContext;

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
        return <div>Unknown step: {currentStep}</div>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Advanced Branching Wizard
          </h1>
          <p className="text-gray-600">
            Experience different paths based on your role selection
          </p>
          {context.role && (
            <div className="mt-3">
              Current Role: <RoleBadge role={context.role} />
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
          <StepNavigator />
          <div className="mt-6">
            {renderStep()}
          </div>
        </div>

        <div className="mt-4 text-center text-sm text-gray-500">
          This wizard demonstrates dynamic navigation based on role and choices
        </div>
      </div>
    </div>
  );
}