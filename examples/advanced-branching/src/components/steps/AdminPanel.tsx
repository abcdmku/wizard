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
        <h2 className="text-2xl font-bold mb-2 dark:text-gray-100">Admin Settings</h2>
        <p className="text-gray-600 dark:text-gray-300">Configure system-wide settings</p>
      </div>

      <div className="space-y-4 bg-gray-50 dark:bg-gray-800 p-4 rounded-lg transition-colors duration-200">
        <h3 className="font-semibold text-lg mb-3 dark:text-gray-100">System Configuration</h3>

        <label className="flex items-center justify-between p-3 bg-white dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600 transition-colors duration-200">
          <div>
            <div className="font-medium dark:text-gray-100">Allow New Registrations</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Enable public user registration</div>
          </div>
          <input
            type="checkbox"
            checked={data?.settings?.allowRegistration || false}
            onChange={() => toggleSetting("allowRegistration")}
            className="h-5 w-5 text-blue-600"
          />
        </label>

        <label className="flex items-center justify-between p-3 bg-white dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600 transition-colors duration-200">
          <div>
            <div className="font-medium dark:text-gray-100">Email Verification</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Require email verification for new users</div>
          </div>
          <input
            type="checkbox"
            checked={data?.settings?.requireEmailVerification || false}
            onChange={() => toggleSetting("requireEmailVerification")}
            className="h-5 w-5 text-blue-600"
          />
        </label>

        <label className="flex items-center justify-between p-3 bg-white dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600 transition-colors duration-200">
          <div>
            <div className="font-medium dark:text-gray-100">Maintenance Mode</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Temporarily disable user access</div>
          </div>
          <input
            type="checkbox"
            checked={data?.settings?.maintenanceMode || false}
            onChange={() => toggleSetting("maintenanceMode")}
            className="h-5 w-5 text-blue-600"
          />
        </label>
      </div>

      <div className="p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg transition-colors duration-200">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={data?.requiresApproval || false}
            onChange={(e) => updateData({ requiresApproval: e.target.checked })}
            className="h-5 w-5 text-yellow-600 mr-3"
          />
          <div>
            <div className="font-medium dark:text-gray-100">Require Manager Approval</div>
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              If checked, you'll need to complete the Manager Dashboard step
            </div>
          </div>
        </label>
      </div>

      {error != null && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300 rounded-md text-sm">
          {String(error)}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={back}
          className="flex-1 py-2 px-4 bg-gray-200 text-gray-800 font-medium rounded-md hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 transition-colors duration-200"
        >
          Back
        </button>
        <button
          onClick={next}
          className="flex-1 py-2 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 transition-colors duration-200"
        >
          {data?.requiresApproval ? "Continue to Manager Dashboard" : "Continue to Review"}
        </button>
      </div>
    </div>
  );
}
