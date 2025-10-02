import { useState } from "react";
import { useBranchingWizard, useManagerDashboardStep } from "../../wizard/config";
import type { ManagerDashboardData } from "../../wizard/types";

export function ManagerDashboard() {
  const { next, back, setStepData, context } = useBranchingWizard();
  const managerStep = useManagerDashboardStep();
  const existingData = managerStep.data;
  
  const [data, setData] = useState<ManagerDashboardData>(
    existingData || {
      teamSize: 5,
      budget: 50000,
      approvalThreshold: 1000,
      delegateApprovals: false,
    }
  );
  const [error, setError] = useState("");

  const handleNext = async () => {
    try {
      setStepData("managerDashboard", data);
      await next();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    }
  };

  const updateField = (field: keyof ManagerDashboardData, value: string | number | boolean) => {
    setData(prev => ({ ...prev, [field]: value }));
    setError("");
  };

  const isAdminApproval = context.role === "admin" && context.requiresApproval;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Manager Dashboard</h2>
        <p className="text-gray-600">
          {isAdminApproval 
            ? "Review and approve admin settings"
            : "Configure team and budget settings"}
        </p>
      </div>

      {isAdminApproval && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="font-medium text-blue-900">Admin Approval Required</div>
          <div className="text-sm text-blue-700 mt-1">
            The admin has requested manager approval for their settings changes.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Team Size</label>
          <input
            type="number"
            value={data.teamSize}
            onChange={(e) => updateField("teamSize", parseInt(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            min="0"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Annual Budget ($)</label>
          <input
            type="number"
            value={data.budget}
            onChange={(e) => updateField("budget", parseInt(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            min="0"
            step="1000"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Approval Threshold ($)</label>
        <input
          type="number"
          value={data.approvalThreshold}
          onChange={(e) => updateField("approvalThreshold", parseInt(e.target.value) || 0)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          min="0"
          step="100"
        />
        <p className="text-sm text-gray-600 mt-1">
          Purchases above this amount require approval
        </p>
      </div>

      <label className="flex items-center p-3 bg-gray-50 rounded border">
        <input
          type="checkbox"
          checked={data.delegateApprovals}
          onChange={(e) => updateField("delegateApprovals", e.target.checked)}
          className="h-5 w-5 text-blue-600 mr-3"
        />
        <div>
          <div className="font-medium">Delegate Approvals</div>
          <div className="text-sm text-gray-600">Allow team leads to approve purchases</div>
        </div>
      </label>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={back}
          className="flex-1 py-2 px-4 bg-gray-200 text-gray-800 font-medium rounded-md hover:bg-gray-300"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          className="flex-1 py-2 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700"
        >
          {isAdminApproval ? "Approve & Continue" : "Continue to Review"}
        </button>
      </div>
    </div>
  );
}