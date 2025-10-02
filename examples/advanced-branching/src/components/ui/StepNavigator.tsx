import { useBranchingWizard } from "../../wizard/config";
import { getAvailableStepsForRole } from "../../wizard/navigation";

const stepLabels: Record<string, string> = {
  roleSelection: "Select Role",
  userProfile: "User Profile",
  adminPanel: "Admin Settings",
  managerDashboard: "Manager Dashboard",
  sharedReview: "Review & Feedback",
};

export function StepNavigator() {
  const { step: currentStep, context } = useBranchingWizard();
  
  const availableSteps = getAvailableStepsForRole(context.role);
  const visibleSteps = availableSteps.filter(step => stepLabels[step]);

  const getStepStatus = (step: string) => {
    if (step === currentStep) return "current";
    if (context.completedSteps.includes(step)) return "completed";
    if (availableSteps.includes(step)) return "available";
    return "unavailable";
  };

  const getStepColor = (status: string) => {
    switch (status) {
      case "current":
        return "bg-blue-600 text-white border-blue-600 dark:bg-blue-700 dark:border-blue-700";
      case "completed":
        return "bg-green-600 text-white border-green-600 dark:bg-green-700 dark:border-green-700";
      case "available":
        return "bg-white text-gray-600 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600";
      default:
        return "bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700";
    }
  };

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        {visibleSteps.map((step, index) => {
          const status = getStepStatus(step);
          const isLast = index === visibleSteps.length - 1;
          
          return (
            <div key={step} className="flex items-center flex-1">
              <div className="flex items-center">
                <div
                  className={`w-10 h-10 rounded-full border-2 flex items-center justify-center font-semibold transition-colors duration-200 ${getStepColor(status)}`}
                >
                  {status === "completed" ? "✓" : index + 1}
                </div>
                <div className="ml-3">
                  <div className={`text-sm font-medium transition-colors duration-200 ${status === "current" ? "text-blue-600 dark:text-blue-400" : "text-gray-900 dark:text-gray-100"}`}>
                    {stepLabels[step]}
                  </div>
                  {status === "current" && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">Current Step</div>
                  )}
                </div>
              </div>
              {!isLast && (
                <div className={`flex-1 h-0.5 mx-4 transition-colors duration-200 ${
                  context.completedSteps.includes(step) ? "bg-green-600 dark:bg-green-700" : "bg-gray-300 dark:bg-gray-600"
                }`} />
              )}
            </div>
          );
        })}
      </div>
      
      {context.role && (
        <div className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
          Path: <span className="font-medium capitalize">{context.role} Journey</span>
        </div>
      )}
    </div>
  );
}