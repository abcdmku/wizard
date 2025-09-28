# PRP: Complete Remaining Wizard Examples

## Mission
Implement the four remaining wizard examples (advanced-branching, persistence-local, router-guard-wizard, zod-validation) following the established patterns from the refactored examples, ensuring clean code separation and demonstrating specific wizard features.

## Context & Current State

### Codebase Structure
- **Monorepo** using pnpm workspaces with TypeScript
- **Core Package** (`packages/core/`): Provides wizard logic, helpers, types
- **React Package** (`packages/react/`): React hooks and router integration
- **Completed Examples**: 
  - basic-form-wizard (clean architecture, 12-line App.tsx)
  - react-router-wizard (proper separation)
  - node-saga-wizard (modular CLI app)

### Existing Patterns to Follow
From successfully refactored examples:
- **App.tsx**: < 50 lines (ideally < 15)
- **File Organization**: wizard/, components/, hooks/ folders
- **Component Size**: < 150 lines per file
- **Separation**: UI components separate from wizard logic
- **Type Safety**: Full TypeScript with extracted types

### Available Wizard Features (from packages/core)
- **Persistence API**: Save/load/clear state methods
- **Router Integration**: useSyncWizardWithRouter hook
- **Guards**: canEnter/canExit step validation
- **Dynamic Navigation**: Conditional next step determination
- **Validation**: Zod integration via createZodValidator
- **Helpers**: Progress tracking, step status, availability checks
- **Context**: Shared state across steps with type inference

## Implementation Blueprint

### Example 1: advanced-branching

#### Purpose
Demonstrate conditional navigation, dynamic step determination, and role-based visibility.

#### File Structure
```
advanced-branching/
├── src/
│   ├── App.tsx                    # Main app (< 20 lines)
│   ├── wizard/
│   │   ├── config.ts              # Dynamic wizard configuration
│   │   ├── types.ts               # User roles, step data types
│   │   └── navigation.ts          # Dynamic routing logic
│   ├── components/
│   │   ├── steps/
│   │   │   ├── RoleSelection.tsx  # Choose user/admin/manager
│   │   │   ├── UserProfile.tsx    # User-only step
│   │   │   ├── AdminPanel.tsx     # Admin-only step
│   │   │   ├── ManagerDashboard.tsx # Manager-only step
│   │   │   └── SharedReview.tsx   # All roles final step
│   │   ├── ui/
│   │   │   ├── RoleBadge.tsx      # Shows current role
│   │   │   └── StepNavigator.tsx  # Dynamic step indicator
│   │   └── WizardContainer.tsx    # Conditional step rendering
│   └── hooks/
│       └── useRoleBasedSteps.ts   # Filter steps by role
```

#### Key Features
```typescript
// wizard/navigation.ts
export const determineNextStep = (
  currentStep: string, 
  role: UserRole, 
  context: WizardContext
): string[] => {
  switch (currentStep) {
    case 'roleSelection':
      // Branch based on selected role
      switch (role) {
        case 'admin': return ['adminPanel', 'sharedReview'];
        case 'manager': return ['managerDashboard', 'sharedReview'];
        case 'user': return ['userProfile', 'sharedReview'];
      }
    case 'adminPanel':
      // Conditional based on admin action
      return context.requiresApproval 
        ? ['managerDashboard', 'sharedReview']
        : ['sharedReview'];
    default:
      return [];
  }
};

// wizard/config.ts
const steps = defineSteps({
  roleSelection: {
    data: { role: '' as UserRole },
    next: ({ data, ctx }) => determineNextStep('roleSelection', data.role, ctx),
    meta: { label: 'Select Role' }
  },
  adminPanel: {
    canEnter: ({ ctx }) => ctx.role === 'admin',
    data: { settings: {} },
    next: ({ ctx }) => determineNextStep('adminPanel', ctx.role, ctx),
    meta: { label: 'Admin Settings', visibleTo: ['admin'] }
  }
  // ... other steps with guards
});
```

### Example 2: persistence-local

#### Purpose
Demonstrate localStorage persistence, state restoration, and recovery from interruptions.

#### File Structure
```
persistence-local/
├── src/
│   ├── App.tsx                    # Main app with persistence provider
│   ├── wizard/
│   │   ├── config.ts              # Wizard with persistence adapter
│   │   ├── types.ts               # Form data types
│   │   └── persistence.ts         # LocalStorage adapter
│   ├── components/
│   │   ├── steps/
│   │   │   ├── PersonalInfo.tsx   # Step 1
│   │   │   ├── WorkExperience.tsx # Step 2
│   │   │   ├── Education.tsx      # Step 3
│   │   │   └── Summary.tsx        # Final review
│   │   ├── ui/
│   │   │   ├── AutoSaveIndicator.tsx # Shows save status
│   │   │   ├── RestorePrompt.tsx     # Resume or start fresh
│   │   │   └── ClearDataButton.tsx   # Reset wizard
│   │   └── WizardContainer.tsx
│   └── hooks/
│       ├── usePersistence.ts      # Save/load/clear hooks
│       └── useAutoSave.ts         # Debounced auto-save
```

#### Key Features
```typescript
// wizard/persistence.ts
export const createLocalStoragePersistence = (key: string) => ({
  save: (state: WizardState) => {
    try {
      const serialized = JSON.stringify({
        ...state,
        savedAt: new Date().toISOString(),
        version: '1.0.0'
      });
      localStorage.setItem(key, serialized);
      return Promise.resolve();
    } catch (error) {
      console.error('Failed to save wizard state:', error);
      return Promise.reject(error);
    }
  },
  
  load: () => {
    try {
      const item = localStorage.getItem(key);
      if (!item) return null;
      
      const parsed = JSON.parse(item);
      // Validate version compatibility
      if (parsed.version !== '1.0.0') {
        console.warn('Incompatible save version');
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },
  
  clear: () => {
    localStorage.removeItem(key);
    return Promise.resolve();
  }
});

// hooks/useAutoSave.ts
export function useAutoSave(delay = 1000) {
  const wizard = useWizard();
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  const debouncedSave = useMemo(
    () => debounce(async () => {
      setSaveStatus('saving');
      await wizard.save();
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, delay),
    [wizard, delay]
  );
  
  useEffect(() => {
    const unsubscribe = wizard.subscribe(() => debouncedSave());
    return unsubscribe;
  }, [wizard, debouncedSave]);
  
  return saveStatus;
}
```

### Example 3: router-guard-wizard

#### Purpose
Demonstrate navigation guards, unsaved changes warnings, and step access control.

#### File Structure
```
router-guard-wizard/
├── src/
│   ├── App.tsx                    # Router setup with guards
│   ├── wizard/
│   │   ├── config.ts              # Wizard with guards
│   │   ├── types.ts               # Step data and context
│   │   └── guards.ts              # Navigation guards
│   ├── components/
│   │   ├── steps/
│   │   │   ├── Introduction.tsx   # No guard needed
│   │   │   ├── Authentication.tsx # Must complete before proceeding
│   │   │   ├── SecureData.tsx     # Requires auth
│   │   │   └── Confirmation.tsx   # Can't go back after confirming
│   │   ├── ui/
│   │   │   ├── GuardedRoute.tsx   # Route protection wrapper
│   │   │   ├── UnsavedPrompt.tsx  # Warn on navigation
│   │   │   └── AccessDenied.tsx   # Show when guard fails
│   │   └── WizardContainer.tsx
│   └── hooks/
│       ├── useNavigationGuard.ts  # Prevent accidental navigation
│       └── useStepAccess.ts       # Check step accessibility
```

#### Key Features
```typescript
// wizard/guards.ts
export const authenticationGuard = {
  canEnter: ({ ctx }: { ctx: WizardContext }) => {
    return ctx.isAuthenticated === true;
  },
  
  canExit: async ({ data, ctx }: { data: any; ctx: WizardContext }) => {
    if (!data.confirmed && ctx.hasUnsavedChanges) {
      // Show confirmation dialog
      const confirmed = await showConfirmDialog(
        'You have unsaved changes. Are you sure you want to leave?'
      );
      return confirmed;
    }
    return true;
  }
};

// hooks/useNavigationGuard.ts
export function useNavigationGuard() {
  const wizard = useWizard();
  const [isBlocking, setIsBlocking] = useState(false);
  
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (wizard.hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [wizard]);
  
  // React Router guard
  usePrompt(
    'You have unsaved changes. Are you sure you want to leave?',
    isBlocking && wizard.hasUnsavedChanges()
  );
  
  return { setIsBlocking };
}

// components/ui/GuardedRoute.tsx
export function GuardedRoute({ step, children }: Props) {
  const wizard = useWizard();
  const canAccess = wizard.helpers.canEnterStep(step);
  
  if (!canAccess) {
    return <AccessDenied step={step} reason={wizard.getGuardFailureReason(step)} />;
  }
  
  return <>{children}</>;
}
```

### Example 4: zod-validation

#### Purpose
Comprehensive Zod schema validation with custom messages and async validation.

#### File Structure
```
zod-validation/
├── src/
│   ├── App.tsx                    # Main app
│   ├── wizard/
│   │   ├── config.ts              # Wizard with Zod validators
│   │   ├── types.ts               # Inferred types from schemas
│   │   └── schemas.ts             # Zod schemas with refinements
│   ├── components/
│   │   ├── steps/
│   │   │   ├── EmailVerification.tsx  # Async email validation
│   │   │   ├── PasswordCreation.tsx   # Complex password rules
│   │   │   ├── ProfileDetails.tsx     # Nested object validation
│   │   │   └── Preferences.tsx        # Array/enum validation
│   │   ├── ui/
│   │   │   ├── FieldError.tsx         # Zod error display
│   │   │   ├── ValidationSummary.tsx  # All errors list
│   │   │   └── PasswordStrength.tsx   # Real-time validation
│   │   └── WizardContainer.tsx
│   └── hooks/
│       ├── useZodForm.ts          # Form with Zod validation
│       └── useAsyncValidation.ts  # Debounced async validation
```

#### Key Features
```typescript
// wizard/schemas.ts
import { z } from 'zod';

export const emailSchema = z.object({
  email: z
    .string()
    .email('Please enter a valid email')
    .refine(
      async (email) => {
        // Check if email is already registered
        const response = await checkEmailAvailability(email);
        return response.available;
      },
      { message: 'This email is already registered' }
    ),
  confirmEmail: z.string().email()
}).refine(
  (data) => data.email === data.confirmEmail,
  {
    message: "Emails don't match",
    path: ['confirmEmail']
  }
);

export const passwordSchema = z.object({
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[a-z]/, 'Must contain lowercase letter')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
  confirmPassword: z.string()
}).refine(
  (data) => data.password === data.confirmPassword,
  {
    message: "Passwords don't match",
    path: ['confirmPassword']
  }
);

export const profileSchema = z.object({
  profile: z.object({
    firstName: z.string().min(2, 'Too short'),
    lastName: z.string().min(2, 'Too short'),
    age: z.number().min(18, 'Must be 18 or older').max(120, 'Invalid age'),
    bio: z.string().max(500, 'Bio too long').optional()
  }),
  
  address: z.object({
    street: z.string().min(5),
    city: z.string().min(2),
    state: z.string().length(2, 'Use 2-letter state code'),
    zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code')
  })
});

export const preferencesSchema = z.object({
  interests: z
    .array(z.enum(['tech', 'sports', 'music', 'art', 'travel']))
    .min(1, 'Select at least one interest')
    .max(3, 'Select up to 3 interests'),
    
  notifications: z.object({
    email: z.boolean(),
    sms: z.boolean(),
    push: z.boolean()
  }).refine(
    (data) => data.email || data.sms || data.push,
    { message: 'Select at least one notification method' }
  ),
  
  timezone: z.string().regex(/^[A-Z]{3,4}$/, 'Invalid timezone')
});

// hooks/useZodForm.ts
export function useZodForm<T extends z.ZodSchema>(
  schema: T,
  defaultValues: z.infer<T>
) {
  const [data, setData] = useState(defaultValues);
  const [errors, setErrors] = useState<z.ZodError | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  
  const validate = useCallback(async () => {
    setIsValidating(true);
    try {
      const validated = await schema.parseAsync(data);
      setErrors(null);
      return { success: true, data: validated };
    } catch (error) {
      if (error instanceof z.ZodError) {
        setErrors(error);
        return { success: false, errors: error.flatten() };
      }
      throw error;
    } finally {
      setIsValidating(false);
    }
  }, [schema, data]);
  
  const getFieldError = (path: string) => {
    if (!errors) return undefined;
    const fieldErrors = errors.formErrors.fieldErrors[path];
    return fieldErrors?.[0];
  };
  
  return {
    data,
    setData,
    errors: errors?.formErrors,
    getFieldError,
    validate,
    isValidating,
    updateField: (field: string, value: any) => {
      setData(prev => ({ ...prev, [field]: value }));
      // Clear field error on change
      if (errors) {
        const newErrors = { ...errors.formErrors.fieldErrors };
        delete newErrors[field];
        setErrors(prev => prev ? { ...prev, formErrors: { ...prev.formErrors, fieldErrors: newErrors } } : null);
      }
    }
  };
}
```

## Implementation Tasks

### Phase 1: advanced-branching
1. [ ] Create project structure with Vite + React + TypeScript
2. [ ] Implement role-based navigation logic
3. [ ] Create RoleSelection step with radio buttons
4. [ ] Implement role-specific steps (User/Admin/Manager)
5. [ ] Add dynamic step indicator showing available paths
6. [ ] Create conditional navigation with guards
7. [ ] Add visualization of branching paths
8. [ ] Write comprehensive README

### Phase 2: persistence-local
1. [ ] Set up Vite project with Tailwind
2. [ ] Implement localStorage persistence adapter
3. [ ] Create multi-step resume builder form
4. [ ] Add auto-save functionality with debouncing
5. [ ] Implement restore prompt on page load
6. [ ] Add save status indicator
7. [ ] Create clear data functionality
8. [ ] Test persistence across browser sessions

### Phase 3: router-guard-wizard
1. [ ] Set up React Router v6 integration
2. [ ] Implement navigation guards (canEnter/canExit)
3. [ ] Create authentication step with validation
4. [ ] Add unsaved changes warning
5. [ ] Implement route protection wrapper
6. [ ] Create access denied component
7. [ ] Add browser beforeunload handler
8. [ ] Test guard behaviors

### Phase 4: zod-validation
1. [ ] Install and configure Zod
2. [ ] Create comprehensive validation schemas
3. [ ] Implement async email validation
4. [ ] Add password strength indicator
5. [ ] Create nested object validation
6. [ ] Implement array/enum validation
7. [ ] Add real-time validation feedback
8. [ ] Create validation summary component

## Validation Gates

```bash
# For each example, run:

# 1. TypeScript compilation
pnpm --filter {example-name} tsc --noEmit

# 2. Build successfully
pnpm --filter {example-name} build

# 3. Check file sizes (no file > 150 lines)
find examples/{example-name}/src -name "*.tsx" -o -name "*.ts" | xargs wc -l | awk '$1 > 150 {print $2 " exceeds 150 lines"}'

# 4. Verify App.tsx is minimal
wc -l examples/{example-name}/src/App.tsx # Should be < 50 lines

# 5. Test functionality manually
pnpm --filter {example-name} dev
# - Test all navigation paths
# - Verify guards work
# - Check persistence/validation
```

## Code Quality Guidelines (from refactor.md)

### Critical Rules
- **No `any` types**: Use proper TypeScript types
- **File size**: Keep files under 150 lines
- **Function size**: Keep functions under 20 lines
- **Component focus**: Single responsibility per component
- **Separation**: UI separate from business logic

### Organization
- **Vertical slices**: Group by feature, not file type
- **Barrel exports**: Use index.ts for clean imports
- **Consistent naming**: PascalCase for components, camelCase for functions
- **Type exports**: Export all types from types.ts

### React Specific
- **Memoization**: Use React.memo, useMemo, useCallback appropriately
- **Custom hooks**: Extract reusable logic
- **Error boundaries**: Handle errors gracefully
- **Accessibility**: Proper ARIA labels and keyboard navigation

## External Resources

### Documentation URLs for Implementation
- **Zod Documentation**: https://zod.dev/ (schemas, refinements, async validation)
- **React Router v6**: https://reactrouter.com/en/main (guards, navigation)
- **React Hook Form + Zod**: https://react-hook-form.com/get-started#SchemaValidation
- **LocalStorage Best Practices**: https://web.dev/articles/storage-for-the-web
- **TypeScript Handbook**: https://www.typescriptlang.org/docs/handbook/2/narrowing.html

### Reference Implementations
- **Existing Examples**: examples/basic-form-wizard (clean structure reference)
- **Router Integration**: packages/react/src/router.ts (sync patterns)
- **Validation**: packages/core/src/zod.ts (createZodValidator helper)
- **Persistence**: See wizard.ts persistence option in core package

## Success Criteria

### Functionality
- [ ] Each example demonstrates its specific feature clearly
- [ ] All TypeScript types are properly inferred
- [ ] No runtime errors in any navigation path
- [ ] Examples work in production build

### Code Quality
- [ ] App.tsx < 50 lines for all examples
- [ ] No file exceeds 150 lines
- [ ] Zero TypeScript errors
- [ ] All validation gates pass

### Documentation
- [ ] Each example has comprehensive README
- [ ] Code includes helpful inline comments
- [ ] Complex logic is well-documented
- [ ] Usage patterns are clear

## Notes for AI Implementation

- Start with package.json setup for each example
- Use existing patterns from basic-form-wizard as reference
- Test each feature incrementally
- Keep commits atomic and descriptive
- Run validation gates after each major change
- Focus on demonstrating the specific feature clearly

## Confidence Score: 8/10

High confidence due to:
- Clear patterns from existing examples
- Well-defined wizard API and features
- Specific implementation details provided
- Comprehensive validation gates

Slight uncertainty (-2) for:
- Exact React Router v6 guard implementation details
- Potential edge cases in async Zod validation
- Browser compatibility for localStorage edge cases