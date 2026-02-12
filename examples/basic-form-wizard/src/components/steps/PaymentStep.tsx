import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { ErrorMessage } from "../ui/ErrorMessage";
import { FormWizard } from "../../wizard/steps";
import { useWizardStep } from "@wizard/react";

function formatCard(input: string) {
  const raw = input.replace(/\D/g, "").slice(0, 16);
  return raw.replace(/(.{4})/g, "$1 ").trim();
}

export function PaymentStep() {
  const step = useWizardStep(FormWizard, "pay");
  const { status, data, error, updateData, back, next } = step;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Payment details</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">Enter your card to complete signup.</p>

      <FormField
        label="Card Number"
        type="text"
        value={data?.card}
        onChange={(value) => updateData({ card: formatCard(value) })}
        placeholder="4242 4242 4242 4242"
      />

      {status === "error" && <ErrorMessage message={String(error)} />}

      <div className="flex gap-3">
        <Button onClick={back} variant="secondary" fullWidth>
          Back
        </Button>
        <Button onClick={next} variant="success" fullWidth>
          Complete
        </Button>
      </div>
    </div>
  );
}
