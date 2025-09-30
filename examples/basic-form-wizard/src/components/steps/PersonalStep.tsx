import { useStore } from "@tanstack/react-store";
import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { ErrorMessage } from "../ui/ErrorMessage";
import { FormWizard } from "../../wizard/steps";

export function PersonalStep() {
  const state = useStore(FormWizard.store);
  const step = FormWizard.getStep("personal");
  const {status, data, error, updateData, next, back} = step;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Personal Information</h2>

      <FormField
        label="First Name"
        type="text"
        value={data?.firstName}
        onChange={(value) => updateData(data => ({ ...data, firstName: value }))}
        placeholder="John"
      />

      <FormField
        label="Last Name"
        type="text"
        value={data?.lastName}
        onChange={(value) => updateData(data => ({ ...data, lastName: value }))}
        placeholder="Doe"
      />

      <FormField
        label="Date of Birth"
        type="date"
        value={data?.dateOfBirth}
        onChange={(value) => updateData(data => ({ ...data, dateOfBirth: value }))}
      />

      {status === 'error' && <ErrorMessage message={String(error)} />}

      <div className="flex gap-3">
        <Button onClick={back} variant="secondary" fullWidth>
          Previous
        </Button>
        <Button onClick={next} fullWidth>
          Next
        </Button>
      </div>
    </div>
  );
}