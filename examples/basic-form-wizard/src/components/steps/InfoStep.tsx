import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { ErrorMessage } from "../ui/ErrorMessage";
import { FormWizard } from "../../wizard/steps";
import { useWizardStep } from "@wizard/react";

export function InfoStep() {
  const step = useWizardStep(FormWizard, "info");
  const { status, data, error, next } = step;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">What is your name?</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">Let&apos;s start with the basics.</p>

      <FormField
        label="Name"
        type="text"
        value={data?.name}
        onChange={(value) => step.updateData({ name: value })}
        placeholder="Enter your name"
      />

      {status === "error" && <ErrorMessage message={String(error)} />}

      <Button onClick={next} fullWidth>
        Next
      </Button>
    </div>
  );
}
