import { defineSteps, step, createWizard } from "./factory";
import type { WizardStepData, IntroductionData, AuthenticationData, SecureData, ConfirmationData } from "./types";

const initialData: WizardStepData = {
  introduction: { agreed: false },
  authentication: { username: "", password: "", verified: false },
  secureData: { secretKey: "", apiEndpoint: "", encryptionEnabled: false },
  confirmation: { confirmed: false }
};

const steps = defineSteps({
  introduction: step({
    data: initialData.introduction,
    next: ["authentication"],
    canExit: ({ data }) => {
      const stepData = data as IntroductionData;
      if (!stepData.agreed) {
        return window.confirm("You haven't agreed to the terms. Are you sure you want to continue?");
      }
      return true;
    },
    meta: { 
      label: "Welcome", 
      protected: false,
      description: "Review terms and conditions"
    }
  }),
  
  authentication: step({
    data: initialData.authentication,
    next: ["secureData"],
    canExit: ({ data, updateContext }) => {
      const stepData = data as AuthenticationData;
      if (!stepData.verified && stepData.username && stepData.password) {
        const proceed = window.confirm("You haven't verified your credentials. Continue anyway?");
        if (!proceed) return false;
      }
      
      // Update authentication status
      if (stepData.verified) {
        updateContext(ctx => {
          ctx.isAuthenticated = true;
          ctx.userId = stepData.username;
        });
      }
      return true;
    },
    beforeExit: ({ updateContext }) => {
      // Mark that there are unsaved changes
      updateContext(ctx => {
        ctx.hasUnsavedChanges = true;
      });
    },
    validate: ({ data }) => {
      const stepData = data as AuthenticationData;
      if (!stepData.username || stepData.username.length < 3) {
        throw new Error("Username must be at least 3 characters");
      }
      if (!stepData.password || stepData.password.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }
    },
    meta: { 
      label: "Login", 
      protected: false,
      description: "Authenticate to access secure areas"
    }
  }),
  
  secureData: step({
    data: initialData.secureData,
    next: ["confirmation"],
    canEnter: ({ context }) => {
      if (!context.isAuthenticated) {
        alert("You must be authenticated to access this step");
        return false;
      }
      return true;
    },
    canExit: ({ context }) => {
      // Warn about unsaved changes
      if (context.hasUnsavedChanges) {
        return window.confirm("You have unsaved changes. Do you want to proceed?");
      }
      return true;
    },
    beforeExit: ({ updateContext }) => {
      updateContext(ctx => {
        ctx.hasUnsavedChanges = false;
        ctx.completedSteps.push("secureData");
      });
    },
    validate: ({ data }) => {
      const stepData = data as SecureData;
      if (!stepData.secretKey) {
        throw new Error("Secret key is required");
      }
      if (!stepData.apiEndpoint || !stepData.apiEndpoint.startsWith("https://")) {
        throw new Error("API endpoint must be a secure HTTPS URL");
      }
    },
    meta: { 
      label: "Secure Area", 
      protected: true,
      description: "Configure secure settings"
    }
  }),
  
  confirmation: step({
    data: initialData.confirmation,
    next: [],
    canEnter: ({ context }) => {
      if (!context.isAuthenticated) {
        alert("Authentication required");
        return false;
      }
      if (!context.completedSteps.includes("secureData")) {
        alert("You must complete secure data configuration first");
        return false;
      }
      return true;
    },
    canExit: () => {
      // Once confirmed, can't go back
      alert("Order has been finalized and cannot be modified");
      return false;
    },
    beforeEnter: () => {
      // Set timestamp when entering confirmation
      return { confirmed: false, timestamp: new Date() };
    },
    beforeExit: ({ data, updateContext }) => {
      const stepData = data as ConfirmationData;
      if (stepData.confirmed) {
        updateContext(ctx => {
          ctx.completedSteps.push("confirmation");
          ctx.lockedSteps = ["introduction", "authentication", "secureData", "confirmation"];
        });
      }
    },
    validate: ({ data }) => {
      const stepData = data as ConfirmationData;
      if (!stepData.confirmed) {
        throw new Error("You must confirm to complete the process");
      }
    },
    meta: { 
      label: "Final Confirmation", 
      protected: true,
      description: "Review and confirm all settings"
    }
  })
});

export const wizard = createWizard(steps);