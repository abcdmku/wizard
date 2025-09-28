import { useState } from "react";
import { useWizardActions, useCurrentStepData } from "@wizard/react";
import type { RoleSelectionData, UserRole } from "../../wizard/types";

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
  const { next, setStepData } = useWizardActions();
  const existingData = useCurrentStepData() as RoleSelectionData | undefined;
  
  const [selectedRole, setSelectedRole] = useState<UserRole>(
    existingData?.role || "user"
  );
  const [error, setError] = useState("");

  const handleNext = async () => {
    try {
      setStepData("roleSelection", { role: selectedRole });
      await next();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to proceed");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Select Your Role</h2>
        <p className="text-gray-600">
          Choose a role to see different wizard paths and features
        </p>
      </div>

      <div className="space-y-3">
        {roles.map((role) => (
          <label
            key={role.value}
            className={`block p-4 border rounded-lg cursor-pointer transition-all ${
              selectedRole === role.value
                ? "border-blue-500 bg-blue-50"
                : "border-gray-300 hover:border-gray-400"
            }`}
          >
            <div className="flex items-start">
              <input
                type="radio"
                name="role"
                value={role.value}
                checked={selectedRole === role.value}
                onChange={(e) => setSelectedRole(e.target.value as UserRole)}
                className="mt-1 mr-3"
              />
              <div>
                <div className="font-semibold">{role.label}</div>
                <div className="text-sm text-gray-600 mt-1">
                  {role.description}
                </div>
              </div>
            </div>
          </label>
        ))}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleNext}
        className="w-full py-2 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Continue as {roles.find((r) => r.value === selectedRole)?.label}
      </button>
    </div>
  );
}