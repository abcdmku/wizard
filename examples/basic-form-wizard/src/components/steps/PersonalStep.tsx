import { useStepForm } from "../../hooks/useStepForm";
import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { ErrorMessage } from "../ui/ErrorMessage";
import type { PersonalData } from "../../wizard/types";

const defaultData: PersonalData = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
};

export function PersonalStep() {
  const { data, updateField, error, handleNext, handleBack } = useStepForm(defaultData);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Personal Information</h2>

      <FormField
        label="First Name"
        type="text"
        value={data.firstName}
        onChange={(value) => updateField("firstName", value)}
        placeholder="John"
      />

      <FormField
        label="Last Name"
        type="text"
        value={data.lastName}
        onChange={(value) => updateField("lastName", value)}
        placeholder="Doe"
      />

      <FormField
        label="Date of Birth"
        type="date"
        value={data.dateOfBirth}
        onChange={(value) => updateField("dateOfBirth", value)}
      />

      {error && <ErrorMessage message={error} />}

      <div className="flex gap-3">
        <Button onClick={handleBack} variant="secondary" fullWidth>
          Previous
        </Button>
        <Button onClick={handleNext} fullWidth>
          Next
        </Button>
      </div>
    </div>
  );
}