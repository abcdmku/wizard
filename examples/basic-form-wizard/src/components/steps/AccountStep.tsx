import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { ErrorMessage } from "../ui/ErrorMessage";
import { FormWizard } from "../../wizard/steps";
import { useWizardStep } from "@wizard/react";

export function AccountStep() {
  const step = useWizardStep(FormWizard, "account");
  const {status, data, error, next} = step;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Create Account</h2>
      <FormField
        label="Email"
        type="email"
        value={data?.email}
        onChange={(value) => step.updateData((currentData) => ({ ...currentData, email: value }))}
        placeholder="you@example.com"
      />

      <FormField
        label="Password"
        type="password"
        value={data?.password}
        onChange={(value) => step.updateData({ password: value })}
        placeholder="Min 8 characters"
      />

      <FormField
        label="Confirm Password"
        type="password"
        value={data?.confirmPassword}
        onChange={(value) => step.updateData({ confirmPassword: value })}
        placeholder="Re-enter password"
      />

      {status === 'error' && <ErrorMessage message={String(error)} />}

      <Button onClick={next} fullWidth>Next</Button>
    </div>
  );
}