import { useAdminPanelStep } from "../../wizard/config";

export function AdminPanel() {
  const step = useAdminPanelStep();
  const { data, error, next, back, updateData } = step;

  const toggleSetting = (setting: string) => {
    updateData((currentData) => ({
      ...currentData,
      settings: {
        allowRegistration: currentData?.settings?.allowRegistration || false,
        requireEmailVerification: currentData?.settings?.requireEmailVerification || false,
        maintenanceMode: currentData?.settings?.maintenanceMode || false,
        [setting]: !currentData?.settings?.[setting as keyof typeof currentData.settings],
      }
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Admin Settings</h2>
        <p className="text-gray-600">Configure system-wide settings</p>
      </div>

      <div className="space-y-4 bg-gray-50 p-4 rounded-lg">
        <h3 className="font-semibold text-lg mb-3">System Configuration</h3>

        <label className="flex items-center justify-between p-3 bg-white rounded border">
          <div>
            <div className="font-medium">Allow New Registrations</div>
            <div className="text-sm text-gray-600">Enable public user registration</div>
          </div>
          <input
            type="checkbox"
            checked={data?.settings?.allowRegistration || false}
            onChange={() => toggleSetting("allowRegistration")}
            className="h-5 w-5 text-blue-600"
          />
        </label>

        <label className="flex items-center justify-between p-3 bg-white rounded border">
          <div>
            <div className="font-medium">Email Verification</div>
            <div className="text-sm text-gray-600">Require email verification for new users</div>
          </div>
          <input
            type="checkbox"
            checked={data?.settings?.requireEmailVerification || false}
            onChange={() => toggleSetting("requireEmailVerification")}
            className="h-5 w-5 text-blue-600"
          />
        </label>

        <label className="flex items-center justify-between p-3 bg-white rounded border">
          <div>
            <div className="font-medium">Maintenance Mode</div>
            <div className="text-sm text-gray-600">Temporarily disable user access</div>
          </div>
          <input
            type="checkbox"
            checked={data?.settings?.maintenanceMode || false}
            onChange={() => toggleSetting("maintenanceMode")}
            className="h-5 w-5 text-blue-600"
          />
        </label>
      </div>

      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={data?.requiresApproval || false}
            onChange={(e) => updateData({ requiresApproval: e.target.checked })}
            className="h-5 w-5 text-yellow-600 mr-3"
          />
          <div>
            <div className="font-medium">Require Manager Approval</div>
            <div className="text-sm text-gray-600 mt-1">
              If checked, you'll need to complete the Manager Dashboard step
            </div>
          </div>
        </label>
      </div>

      {error != null && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">
          {String(error)}
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
          onClick={next}
          className="flex-1 py-2 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700"
        >
          {data?.requiresApproval ? "Continue to Manager Dashboard" : "Continue to Review"}
        </button>
      </div>
    </div>
  );
}
