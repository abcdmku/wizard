import { Button } from "../ui/Button";
import { ErrorMessage } from "../ui/ErrorMessage";
import { FormWizard } from "../../wizard/steps";
import { useWizardStep } from "@wizard/react";

const PLAN_OPTIONS = [
  { id: "free", label: "Free", price: "$0/mo", description: "For side projects" },
  { id: "pro", label: "Pro", price: "$12/mo", description: "For professionals" },
  { id: "team", label: "Team", price: "$49/mo", description: "For organizations" },
] as const;

export function PlanStep() {
  const step = useWizardStep(FormWizard, "plan");
  const { status, data, error, updateData, back, next } = step;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Choose your plan</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">Pick the tier that fits your needs.</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PLAN_OPTIONS.map((plan) => {
          const selected = data?.tier === plan.id;
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => updateData({ tier: plan.id })}
              className={`rounded-md border p-3 text-left transition-colors ${
                selected
                  ? "border-blue-600 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <p className="font-semibold text-gray-900 dark:text-gray-100">{plan.label}</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">{plan.price}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{plan.description}</p>
            </button>
          );
        })}
      </div>

      {status === "error" && <ErrorMessage message={String(error)} />}

      <div className="flex gap-3">
        <Button onClick={back} variant="secondary" fullWidth>
          Back
        </Button>
        <Button onClick={next} fullWidth>
          Next
        </Button>
      </div>
    </div>
  );
}
