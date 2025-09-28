# Advanced Branching Wizard Example

This example demonstrates dynamic navigation, role-based step visibility, and conditional branching in a wizard flow.

## What This Example Demonstrates

- **Dynamic Navigation**: Steps change based on user role selection
- **Role-Based Access**: Different paths for User, Admin, and Manager roles
- **Conditional Branching**: Admin can trigger Manager approval flow
- **Step Guards**: Access control using `canEnter` functions
- **Visual Path Indicator**: Shows available steps for current role
- **Context Sharing**: Role persists across all steps

## Structure

```
src/
├── App.tsx                    # Main app (12 lines)
├── wizard/
│   ├── config.ts              # Dynamic wizard configuration
│   ├── types.ts               # TypeScript types for all data
│   └── navigation.ts          # Dynamic routing logic
├── components/
│   ├── steps/
│   │   ├── RoleSelection.tsx  # Choose user/admin/manager
│   │   ├── UserProfile.tsx    # User-only step
│   │   ├── AdminPanel.tsx     # Admin-only step
│   │   ├── ManagerDashboard.tsx # Manager-only step
│   │   └── SharedReview.tsx   # All roles final step
│   ├── ui/
│   │   ├── RoleBadge.tsx      # Shows current role
│   │   └── StepNavigator.tsx  # Dynamic step indicator
│   └── WizardContainer.tsx    # Conditional step rendering
└── hooks/
    └── useRoleBasedSteps.ts   # Filter steps by role
```

## Key Features

### Dynamic Paths

Each role follows a different path through the wizard:

- **User**: Role Selection → User Profile → Review
- **Admin**: Role Selection → Admin Panel → (Manager Dashboard if approval needed) → Review
- **Manager**: Role Selection → Manager Dashboard → Review

### Conditional Navigation

The Admin can trigger an approval flow that adds the Manager Dashboard step:

```typescript
// In AdminPanel component
if (data.requiresApproval) {
  // Next step will be Manager Dashboard instead of Review
}
```

### Role-Based Guards

Steps use `canEnter` to control access:

```typescript
canEnter: ({ ctx }) => canAccessStep('adminPanel', ctx.role, ctx)
```

### Dynamic Step Indicator

The step navigator shows only the steps available to the current role:

```typescript
const availableSteps = getAvailableStepsForRole(context.role);
```

## Running the Example

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

## Usage Flow

1. **Start**: Select a role (User, Admin, or Manager)
2. **Role-Specific Steps**: Complete the steps specific to your role
3. **Conditional Branching**: If Admin, optionally require Manager approval
4. **Review**: All roles end with a feedback/review step

## Code Organization

### Navigation Logic (`wizard/navigation.ts`)
- `determineNextStep()`: Returns next steps based on current step and role
- `getAvailableStepsForRole()`: Lists all steps a role can access
- `canAccessStep()`: Guards for step access control

### Wizard Configuration (`wizard/config.ts`)
- Dynamic `next` functions that consider role and context
- Step-specific validation and guards
- Meta information for UI display

### Step Components
- Each step is a self-contained component
- Uses wizard hooks for navigation and data management
- Validates data before proceeding

## Technologies Used

- React 18
- TypeScript
- @wizard/core & @wizard/react
- Tailwind CSS
- Vite

## Files Overview

- **App.tsx**: Minimal wrapper providing wizard context (12 lines)
- **wizard/**: Contains all wizard logic and types
- **components/steps/**: Individual step components with validation
- **components/ui/**: Reusable UI components
- **hooks/**: Custom React hooks for role-based logic