import { useWizard } from "@wizard/react";
import { FormWizard } from "../../wizard/steps";

export function DoneStep() {
  const { data, reset } = useWizard(FormWizard);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-green-600 dark:text-green-400">All done!</h2>
      <p className="text-gray-600 dark:text-gray-300">Your wizard flow is complete.</p>

      <div className="space-y-3 rounded-md bg-gray-50 p-4 dark:bg-gray-700">
        <p className="text-sm text-gray-700 dark:text-gray-300">Name: {data.info?.name}</p>
        <p className="text-sm text-gray-700 dark:text-gray-300">Plan: {data.plan?.tier}</p>
        <p className="text-sm text-gray-700 dark:text-gray-300">Card: {data.pay?.card}</p>
      </div>

      <ButtonRow reset={reset} />
    </div>
  );
}

function ButtonRow({ reset }: { reset: () => void }) {
  return (
    <button
      type="button"
      onClick={reset}
      className="w-full rounded-md border border-gray-200 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
    >
      Start over
    </button>
  );
}
