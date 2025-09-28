import { useState } from "react";
import { useWizardActions, useWizardStep, useCurrentStepData } from "@wizard/react";

export function useStepForm<T extends Record<string, any>>(
  defaultData: T
) {
  const { next, back, setStepData } = useWizardActions();
  const currentStep = useWizardStep();
  const existingData = useCurrentStepData() as T | undefined;
  
  const [data, setData] = useState<T>(() => existingData || defaultData);
  const [error, setError] = useState<string>("");

  const updateField = <K extends keyof T>(field: K, value: T[K]) => {
    setData((prev) => ({ ...prev, [field]: value }));
    setError(""); // Clear error on field change
  };

  const handleNext = async () => {
    try {
      setStepData(currentStep, data);
      await next();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    }
  };

  const handleBack = () => {
    setStepData(currentStep, data);
    back();
  };

  return {
    data,
    setData,
    updateField,
    error,
    handleNext,
    handleBack,
  };
}