  Full Implementation Plan: Hybrid Hook API + Documentation

  Phase 1: Implement React Hooks Package

  1.1 Create packages/react/src/WizardProvider.tsx

  - Export WizardContext (React Context)
  - Export WizardProvider component
  - Export useWizardContext<W>() internal hook
  - Uses Wizard type from @wizard/core

  1.2 Create packages/react/src/hooks.tsx

  Hybrid API Design:

  1. useWizard(wizard) - Kitchen sink hook (VALUE PARAMETER)
    - Takes wizard instance as parameter
    - Returns everything flattened: step, data, context, history, visitedSteps, runtime, errors, isLoading
    - Returns all methods: next, back, goTo, canGoTo, reset, updateStepData, updateContext, getStep, getCurrentStep
    - Returns store reference
  2. useCurrentStep<W>() - TYPE PARAMETER
  3. useWizardStep<W>(stepName) - TYPE PARAMETER
  4. useWizardProgress<W>() - TYPE PARAMETER
  5. useWizardActions<W>() - TYPE PARAMETER
  6. useWizardHelpers<W>() - TYPE PARAMETER
  7. useStepError<W>(stepName?) - TYPE PARAMETER
  8. useWizardSelector<W, Selected>(selector) - TYPE PARAMETER

  1.3 Create packages/react/src/index.ts

  - Export all hooks
  - Export WizardProvider and types

  ---
  Phase 2: Update Example Components

  2.1 Create Typed Hook in Wizard Definition

  Update examples/basic-form-wizard/src/wizard/steps.ts:
  import { createWizard } from "@wizard/core";
  import { useWizard } from "@wizard/react";

  export const FormWizard = createWizard({ ... });

  // Export typed hook for convenience
  export const useFormWizard = () => useWizard(FormWizard);

  2.2 Update examples/basic-form-wizard/src/App.tsx

  import { WizardProvider } from "@wizard/react";
  // Already correct

  2.3 Update Components

  - WizardContainer.tsx - Use useFormWizard()
  - StepIndicator.tsx - Use typed hooks
  - SummaryStep.tsx - Use useFormWizard()
  - Other steps verify they work with context

  ---
  Phase 3: Documentation

  3.1 Delete Old React Documentation

  - packages/docs/pages/react.mdx
  - packages/docs/pages/react/hooks.mdx (if exists)
  - packages/docs/pages/react/router-integration.mdx (if exists)
  - packages/docs/pages/api-docs/react.mdx (if exists)
  - packages/docs/pages/examples/react-router-wizard.mdx (if exists)

  3.2 Create New packages/docs/pages/react.mdx

  Structure:
  1. Introduction - Overview, installation (npm install @wizard/react)
  2. Quick Start - Complete example with WizardProvider
  3. Core Concepts - Type parameters, context provider
  4. Hook Reference - All 8 hooks documented
  5. Creating Typed Hooks (Best Practice) - Show convenience pattern
  6. Common Patterns - Forms, validation, navigation
  7. TypeScript - Type safety examples
  8. Performance - Hook optimization guide
  9. Examples - Link to basic-form-wizard

  Document both approaches:
  // Generic hooks
  const wizard = useWizard(FormWizard);
  const step = useCurrentStep<typeof FormWizard>();

  // Typed convenience hooks (recommended)
  export const useFormWizard = () => useWizard(FormWizard);
  const wizard = useFormWizard();

  ---
  Phase 4: Testing & Verification

  1. Run pnpm --filter basic-form-wizard dev
  2. Verify navigation, validation, UI updates
  3. Check TypeScript errors
  4. Verify IntelliSense

  ---
