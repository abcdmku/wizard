import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { ErrorMessage } from "../ui/ErrorMessage";
import { FormWizard } from "../../wizard/steps";


export function AccountStep() {
  const {status, data, error, updateData, next} = FormWizard.getStep("account")

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Create Account</h2>
      <FormField
        label="Email"
        type="email"
        value={data?.email}
        onChange={(value) => updateData(data => ({ ...data, email: value }))}
        placeholder="you@example.com"
      />

      <FormField
        label="Password"
        type="password"
        value={data?.password}
        onChange={(value) => updateData(data => ({ ...data, password: value }))}
        placeholder="Min 8 characters"
      />

      <FormField
        label="Confirm Password"
        type="password"
        value={data?.confirmPassword}
        onChange={(value) => updateData(data => ({ ...data, confirmPassword: value }))}
        placeholder="Re-enter password"
      />

      {status === 'error' && <ErrorMessage message={String(error)} />}

      <Button onClick={next} fullWidth>Next</Button>
    </div>
  );
}