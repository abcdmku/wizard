# Basic Form Wizard Example

This example demonstrates a clean multi-step registration form with proper separation of concerns.

## What This Example Demonstrates

- **Clean Architecture**: Separation between wizard logic, UI components, and validation
- **Reusable Components**: FormField, Button, ErrorMessage components
- **Custom Hooks**: useStepForm for managing form state
- **Type Safety**: Full TypeScript types for all data
- **Validation**: Centralized validation logic
- **Progress Indication**: Visual step indicator showing current progress

## Structure

```
src/
├── App.tsx                    # Main app (13 lines)
├── wizard/
│   ├── config.ts              # Wizard configuration
│   ├── types.ts               # Type definitions
│   └── validation.ts          # Validation logic
├── components/
│   ├── steps/
│   │   ├── AccountStep.tsx    # Account form (50 lines)
│   │   ├── PersonalStep.tsx   # Personal info (54 lines)
│   │   └── AddressStep.tsx    # Address form (132 lines)
│   ├── ui/
│   │   ├── FormField.tsx      # Reusable form field
│   │   ├── Button.tsx         # Styled button
│   │   ├── ErrorMessage.tsx   # Error display
│   │   └── StepIndicator.tsx  # Progress indicator
│   └── WizardContainer.tsx    # Main wizard wrapper
└── hooks/
    └── useStepForm.ts         # Form state management

```

## Key Features

### Wizard Configuration
All wizard logic is extracted to `wizard/config.ts`:
- Step definitions
- Validation rules
- Navigation flow
- Initial data

### Reusable UI Components
Common UI patterns extracted to `components/ui/`:
- FormField with built-in error handling
- Button with variant styles
- Consistent error messaging
- Progress indicator

### Custom Hook
`useStepForm` provides:
- Form state management
- Field updates
- Error handling
- Navigation actions

## Running the Example

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

## Usage Pattern

This example shows the recommended pattern for building form wizards:

1. **Define types** in a separate file
2. **Extract validation** to keep components clean
3. **Use custom hooks** for repeated logic
4. **Keep components small** (< 150 lines)
5. **Separate UI from logic**

## Files Overview

- **App.tsx**: Minimal wrapper providing wizard context
- **wizard/**: Contains all wizard-specific logic
- **components/steps/**: Individual step components using shared UI
- **components/ui/**: Reusable UI components
- **hooks/**: Custom React hooks for common patterns