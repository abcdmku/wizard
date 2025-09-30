import { useStore } from "@tanstack/react-store";
import { FormWizard } from "../../wizard/steps";
import type { AccountData, PersonalData, AddressData } from "../../wizard/steps";

export function SummaryStep() {
  const state = useStore(FormWizard.store);

  // Use the state to get all step data
  const accountData = state.data.account as AccountData | undefined;
  const personalData = state.data.personal as PersonalData | undefined;
  const addressData = state.data.address as AddressData | undefined;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-green-600 dark:text-green-400">Registration Complete!</h2>
      <p className="text-gray-600 dark:text-gray-300">Thank you for registering. Here's a summary:</p>

      <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md space-y-2">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Account</h3>
        <p className="text-sm text-gray-700 dark:text-gray-300">Email: {accountData?.email}</p>
      </div>

      <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md space-y-2">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Personal</h3>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Name: {personalData?.firstName} {personalData?.lastName}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">Date of Birth: {personalData?.dateOfBirth}</p>
      </div>

      <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md space-y-2">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Address</h3>
        <p className="text-sm text-gray-700 dark:text-gray-300">{addressData?.street}</p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {addressData?.city}, {addressData?.state} {addressData?.zipCode}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">{addressData?.country}</p>
      </div>
    </div>
  );
}