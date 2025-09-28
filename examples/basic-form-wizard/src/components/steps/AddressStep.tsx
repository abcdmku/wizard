import { useState } from "react";
import { useStepForm } from "../../hooks/useStepForm";
import { useWizardState, useWizardActions } from "@wizard/react";
import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { ErrorMessage } from "../ui/ErrorMessage";
import type { AddressData, AccountData, PersonalData } from "../../wizard/types";

const defaultData: AddressData = {
  street: "",
  city: "",
  state: "",
  zipCode: "",
  country: "",
};

export function AddressStep() {
  const { data, updateField, error, handleBack } = useStepForm(defaultData);
  const { setStepData } = useWizardActions();
  const wizardState = useWizardState();
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const handleSubmit = async () => {
    try {
      // Validate address data
      if (!data.street || !data.city || !data.state || !data.zipCode || !data.country) {
        throw new Error("Please fill in all address fields");
      }
      
      setStepData("address", data);
      setSubmitted(true);
      setSubmitError("");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Validation failed");
    }
  };

  if (submitted) {
    const accountData = wizardState.data.account as AccountData | undefined;
    const personalData = wizardState.data.personal as PersonalData | undefined;

    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-green-600">Registration Complete!</h2>
        <p className="text-gray-600">Thank you for registering. Here's a summary:</p>

        <div className="bg-gray-50 p-4 rounded-md space-y-2">
          <h3 className="font-semibold">Account</h3>
          <p className="text-sm">Email: {accountData?.email}</p>
        </div>

        <div className="bg-gray-50 p-4 rounded-md space-y-2">
          <h3 className="font-semibold">Personal</h3>
          <p className="text-sm">
            Name: {personalData?.firstName} {personalData?.lastName}
          </p>
          <p className="text-sm">Date of Birth: {personalData?.dateOfBirth}</p>
        </div>

        <div className="bg-gray-50 p-4 rounded-md space-y-2">
          <h3 className="font-semibold">Address</h3>
          <p className="text-sm">{data.street}</p>
          <p className="text-sm">
            {data.city}, {data.state} {data.zipCode}
          </p>
          <p className="text-sm">{data.country}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Address Information</h2>

      <FormField
        label="Street Address"
        type="text"
        value={data.street}
        onChange={(value) => updateField("street", value)}
        placeholder="123 Main St"
      />

      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="City"
          type="text"
          value={data.city}
          onChange={(value) => updateField("city", value)}
          placeholder="New York"
        />

        <FormField
          label="State"
          type="text"
          value={data.state}
          onChange={(value) => updateField("state", value)}
          placeholder="NY"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="ZIP Code"
          type="text"
          value={data.zipCode}
          onChange={(value) => updateField("zipCode", value)}
          placeholder="10001"
        />

        <FormField
          label="Country"
          type="text"
          value={data.country}
          onChange={(value) => updateField("country", value)}
          placeholder="USA"
        />
      </div>

      {(error || submitError) && <ErrorMessage message={error || submitError} />}

      <div className="flex gap-3">
        <Button onClick={handleBack} variant="secondary" fullWidth>
          Previous
        </Button>
        <Button onClick={handleSubmit} variant="success" fullWidth>
          Submit
        </Button>
      </div>
    </div>
  );
}