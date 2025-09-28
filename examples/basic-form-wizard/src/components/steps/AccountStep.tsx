import { useStepForm } from "../../hooks/useStepForm";
import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { ErrorMessage } from "../ui/ErrorMessage";
import type { AccountData } from "../../wizard/types";

const defaultData: AccountData = {
  email: "",
  password: "",
  confirmPassword: "",
};

export function AccountStep() {
  const { data, updateField, error, handleNext } = useStepForm(defaultData);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Create Account</h2>

      <FormField
        label="Email"
        type="email"
        value={data.email}
        onChange={(value) => updateField("email", value)}
        placeholder="you@example.com"
      />

      <FormField
        label="Password"
        type="password"
        value={data.password}
        onChange={(value) => updateField("password", value)}
        placeholder="Min 8 characters"
      />

      <FormField
        label="Confirm Password"
        type="password"
        value={data.confirmPassword}
        onChange={(value) => updateField("confirmPassword", value)}
        placeholder="Re-enter password"
      />

      {error && <ErrorMessage message={error} />}

      <Button onClick={handleNext} fullWidth>
        Next
      </Button>
    </div>
  );
}