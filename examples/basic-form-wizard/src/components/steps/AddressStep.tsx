import { FormField } from "../ui/FormField";
import { Button } from "../ui/Button";
import { ErrorMessage } from "../ui/ErrorMessage";
import { useAddressStep } from "../../wizard/steps";

export function AddressStep() {
  const step = useAddressStep();
  const {status, data, error, updateData, back, next} = step;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Address Information</h2>

      <FormField
        label="Street Address"
        type="text"
        value={data?.street}
        onChange={(value) => updateData({ street: value })}
        placeholder="123 Main St"
      />

      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="City"
          type="text"
          value={data?.city}
          onChange={(value) => updateData({ city: value })}
          placeholder="New York"
        />

        <FormField
          label="State"
          type="text"
          value={data?.state}
          onChange={(value) => updateData({ state: value })}
          placeholder="NY"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="ZIP Code"
          type="text"
          value={data?.zipCode}
          onChange={(value) => updateData({ zipCode: value })}
          placeholder="10001"
        />

        <FormField
          label="Country"
          type="text"
          value={data?.country}
          onChange={(value) => updateData({ country: value })}
          placeholder="USA"
        />
      </div>

      {status === 'error' && <ErrorMessage message={String(error)} />}

      <div className="flex gap-3">
        <Button onClick={back} variant="secondary" fullWidth>
          Previous
        </Button>
        <Button onClick={next} variant="success" fullWidth>
          Submit
        </Button>
      </div>
    </div>
  );
}