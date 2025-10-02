import { defineSteps, step, createWizard } from "./factory";
import { useWizard, useWizardStep } from "@wizard/react";
import {
  PersonalInfoSchema,
  AddressSchema,
  PreferencesSchema,
  ReviewSchema,
  type PersonalInfo,
  type Address,
  type Preferences,
  type Review,
  type ValidationContext
} from "./types";

const initialData = {
  personalInfo: {
    firstName: "",
    lastName: "",
    email: "",
    age: 18
  } as PersonalInfo,
  address: {
    street: "",
    city: "",
    state: "",
    zipCode: ""
  } as Address,
  preferences: {
    newsletter: false,
    notifications: {
      email: true,
      sms: false,
      push: false
    },
    theme: "auto" as const,
    language: "en" as const
  } as Preferences,
  review: {
    agreeToTerms: false,
    dataProcessing: false
  } as Review
};

const steps = defineSteps({
  personalInfo: step({
    data: initialData.personalInfo,
    next: ["address"],
    validate: ({ data }) => {
      const result = PersonalInfoSchema.safeParse(data);
      
      if (!result.success) {
        throw new Error("Please fix validation errors before proceeding");
      }
    },
    beforeExit: ({ updateContext }) => {
      updateContext((ctx: ValidationContext) => {
        delete ctx.validationErrors.personalInfo;
        if (!ctx.completedSteps.includes("personalInfo")) {
          ctx.completedSteps.push("personalInfo");
        }
      });
    },
    meta: {
      label: "Personal Info",
      description: "Enter your personal information"
    }
  }),

  address: step({
    data: initialData.address,
    next: ["preferences"],
    validate: ({ data }) => {
      const result = AddressSchema.safeParse(data);
      
      if (!result.success) {
        throw new Error("Please fix validation errors before proceeding");
      }
    },
    beforeExit: ({ updateContext }) => {
      updateContext((ctx: ValidationContext) => {
        delete ctx.validationErrors.address;
        if (!ctx.completedSteps.includes("address")) {
          ctx.completedSteps.push("address");
        }
      });
    },
    meta: {
      label: "Address",
      description: "Enter your address details"
    }
  }),

  preferences: step({
    data: initialData.preferences,
    next: ["review"],
    validate: ({ data }) => {
      const result = PreferencesSchema.safeParse(data);
      
      if (!result.success) {
        throw new Error("Please fix validation errors before proceeding");
      }
    },
    beforeExit: ({ updateContext }) => {
      updateContext((ctx: ValidationContext) => {
        delete ctx.validationErrors.preferences;
        if (!ctx.completedSteps.includes("preferences")) {
          ctx.completedSteps.push("preferences");
        }
      });
    },
    meta: {
      label: "Preferences",
      description: "Configure your preferences"
    }
  }),

  review: step({
    data: initialData.review,
    next: [],
    validate: ({ data }) => {
      const result = ReviewSchema.safeParse(data);
      
      if (!result.success) {
        throw new Error("Please accept all terms to complete registration");
      }
    },
    beforeExit: ({ updateContext }) => {
      updateContext((ctx: ValidationContext) => {
        delete ctx.validationErrors.review;
        if (!ctx.completedSteps.includes("review")) {
          ctx.completedSteps.push("review");
        }
        // Mark wizard as complete
        ctx.completedSteps = ["personalInfo", "address", "preferences", "review"];
      });
    },
    canExit: ({ data }) => {
      const reviewData = data as Review;
      if (!reviewData.agreeToTerms || !reviewData.dataProcessing) {
        return window.confirm("You haven't accepted all terms. Are you sure you want to leave?");
      }
      return true;
    },
    meta: {
      label: "Review & Submit",
      description: "Review your information and submit"
    }
  })
});

export const wizard = createWizard(steps) as ReturnType<typeof createWizard<typeof steps>>;

/**
 * Typed convenience hook for using wizard.
 */
export const useValidationWizard = () => useWizard(wizard);

/**
 * Step-specific typed convenience hooks.
 */
export const usePersonalInfoStep = () => useWizardStep(wizard, "personalInfo");
export const useAddressStep = () => useWizardStep(wizard, "address");
export const usePreferencesStep = () => useWizardStep(wizard, "preferences");
export const useReviewStep = () => useWizardStep(wizard, "review");