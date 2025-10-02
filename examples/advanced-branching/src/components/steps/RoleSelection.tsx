import { useRoleSelectionStep, useBranchingWizard } from "../../wizard/config";
import type { UserRole } from "../../wizard/types";

const roles: { value: UserRole; label: string; description: string }[] = [
  {
    value: "user",
    label: "User",
    description: "Regular user with basic access to personal profile",
  },
  {
    value: "admin",
    label: "Administrator",
    description: "Full system access with ability to configure settings",
  },
  {
    value: "manager",
    label: "Manager",
    description: "Team management with budget and approval controls",
  },
];

export function RoleSelection() {
  const step = useRoleSelectionStep();
  const { updateContext, context } = useBranchingWizard();
  const { data, error, next, updateData } = step;

  const selectedRole = data?.role || "user";

  const handleRoleChange = (newRole: UserRole) => {
    updateData({ role: newRole });

    // Update context immediately to show correct role badge and progress
    updateContext((ctx) => {
      // If role changed, reset completed steps
      if (ctx.role !== newRole) {
        ctx.completedSteps = ctx.completedSteps.includes('roleSelection')
          ? ['roleSelection']
          : [];
      }
      ctx.role = newRole;
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 dark:text-gray-100">Select Your Role</h2>
        <p className="text-gray-600 dark:text-gray-300">
          Choose a role to see different wizard paths and features
        </p>
      </div>

      <div className="space-y-3">
        {roles.map((role) => (
          <label
            key={role.value}
            className={`block p-4 border rounded-lg cursor-pointer transition-colors duration-200 ${
              selectedRole === role.value
                ? "border-blue-500 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/30"
                : "border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500"
            }`}
          >
            <div className="flex items-start">
              <input
                type="radio"
                name="role"
                value={role.value}
                checked={selectedRole === role.value}
                onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                className="mt-1 mr-3"
              />
              <div>
                <div className="font-semibold dark:text-gray-100">{role.label}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {role.description}
                </div>
              </div>
            </div>
          </label>
        ))}
      </div>

      {error != null && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300 rounded-md text-sm">
          {String(error)}
        </div>
      )}

      <button
        onClick={next}
        className="w-full py-2 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-200"
      >
        Continue as {roles.find((r) => r.value === selectedRole)?.label}
      </button>
    </div>
  );
}