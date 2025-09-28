# PRP: Examples Refactor for Clarity and Best Practices

## Mission
Refactor all examples in the examples folder to simplify code, separate concerns, and make each example clearly demonstrate its specific feature. Examples should follow React and TypeScript best practices with clean separation between UI components and wizard logic.

## Context & Current State

### Codebase Structure
- **Monorepo** using pnpm workspaces with TypeScript
- **Core Package** (`packages/core/`): Headless wizard logic  
- **React Package** (`packages/react/`): React hooks and provider
- **Examples Folder** (`examples/`): Working implementations

### Current Examples
1. **basic-form-wizard**: Multi-step registration form (424 lines in single App.tsx)
2. **react-router-wizard**: Checkout flow with proper separation
3. **node-saga-wizard**: CLI order processing workflow
4. **advanced-branching**: (Not yet implemented)
5. **persistence-local**: (Not yet implemented) 
6. **router-guard-wizard**: (Not yet implemented)
7. **zod-validation**: (Not yet implemented)

### Identified Issues

#### basic-form-wizard/src/App.tsx
- **424 lines** in a single file mixing:
  - Wizard configuration
  - Validation logic  
  - 3 step components (AccountStep, PersonalStep, AddressStep)
  - Step indicator component
  - Main app component
- No type extraction or reusable patterns
- Inline validation functions
- Repetitive error handling logic

#### node-saga-wizard/src/index.ts  
- **361 lines** in single file
- CLI logic mixed with wizard configuration
- Could benefit from separating saga logic

#### Good Example: react-router-wizard
- Proper file separation:
  - `wizard.ts`: Wizard configuration
  - `types.ts`: Type definitions and schemas
  - `components/`: Individual step components
  - `App.tsx`: Minimal app wrapper

## Research Findings

### Best Practices from React Documentation
- **Component Composition**: Small, focused components
- **Separation of Concerns**: Logic separate from presentation
- **Type Safety**: Explicit types for public APIs
- **File Organization**: Feature-based structure

### TypeScript Monorepo Conventions (from CLAUDE.md)
- **Vertical Slice Principle**: Group by feature, not type
- **KISS**: Keep it simple and readable
- **Max line length**: 100 characters
- **Naming**: camelCase for functions, PascalCase for components
- **Testing**: Co-locate tests with source

### Tailwind CSS Best Practices
- Extract common styles to utility classes
- Use component classes for repeated patterns
- Avoid inline styles unless dynamic

## Implementation Blueprint

### Phase 1: Refactor basic-form-wizard

#### File Structure
```
basic-form-wizard/
├── src/
│   ├── App.tsx                    # Main app (< 50 lines)
│   ├── wizard/
│   │   ├── config.ts              # Wizard configuration
│   │   ├── types.ts               # Type definitions
│   │   └── validation.ts          # Validation schemas
│   ├── components/
│   │   ├── steps/
│   │   │   ├── AccountStep.tsx    # Account form
│   │   │   ├── PersonalStep.tsx   # Personal info form
│   │   │   └── AddressStep.tsx    # Address form
│   │   ├── ui/
│   │   │   ├── StepIndicator.tsx  # Progress indicator
│   │   │   ├── FormField.tsx      # Reusable form field
│   │   │   ├── ErrorMessage.tsx   # Error display
│   │   │   └── Button.tsx         # Styled button
│   │   └── WizardContainer.tsx    # Main wizard wrapper
│   └── hooks/
│       └── useStepForm.ts         # Reusable form logic
```

#### Key Refactoring Tasks
1. **Extract wizard configuration** to `wizard/config.ts`
2. **Create shared UI components** in `components/ui/`
3. **Extract validation** to `wizard/validation.ts` using Zod
4. **Create reusable hook** `useStepForm.ts` for common logic
5. **Simplify step components** to ~50 lines each

### Phase 2: Enhance node-saga-wizard

#### File Structure
```
node-saga-wizard/
├── src/
│   ├── index.ts                   # Entry point (< 50 lines)
│   ├── wizard/
│   │   ├── orderWizard.ts         # Wizard configuration
│   │   ├── types.ts               # Type definitions
│   │   └── validation.ts          # Zod schemas
│   ├── saga/
│   │   ├── automated.ts           # Automated saga flow
│   │   └── handlers.ts            # Step handlers
│   └── cli/
│       └── interactive.ts         # Interactive CLI
```

### Phase 3: Implement Missing Examples

#### advanced-branching
- Demonstrate conditional step navigation
- Show dynamic next step determination
- Include role-based step visibility

#### persistence-local  
- Show localStorage persistence
- Demonstrate state restoration
- Include clear/reset functionality

#### router-guard-wizard
- Demonstrate route guards
- Show navigation prevention
- Include unsaved changes warning

#### zod-validation
- Comprehensive Zod integration
- Custom error messages
- Async validation examples

## Implementation Details

### Reusable Components

#### FormField Component
```typescript
// components/ui/FormField.tsx
interface FormFieldProps {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
}

export function FormField({ label, error, ...props }: FormFieldProps) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">{label}</label>
      <input
        className={cn(
          "w-full px-3 py-2 border rounded-md",
          error && "border-red-500"
        )}
        {...props}
      />
      {error && <ErrorMessage message={error} />}
    </div>
  );
}
```

#### useStepForm Hook
```typescript
// hooks/useStepForm.ts
export function useStepForm<T>(initialData: T) {
  const { next, back, setStepData } = useWizardActions();
  const [data, setData] = useState<T>(initialData);
  const [error, setError] = useState<string>('');
  
  const handleNext = async () => {
    try {
      setStepData(currentStep, data);
      await next();
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };
  
  return { data, setData, error, handleNext, back };
}
```

### Pattern Library

#### Wizard Configuration Pattern
```typescript
// wizard/config.ts
import { createWizard, defineSteps } from '@wizard/core';
import { validators } from './validation';

const steps = defineSteps({
  step1: {
    validate: validators.step1,
    data: initialData.step1,
    next: ['step2'],
    meta: { label: 'Step 1' }
  }
  // ...
});

export const wizard = createWizard({
  context: {},
  steps
});
```

## Validation Gates

```bash
# Each example must pass these checks

# 1. TypeScript compilation
pnpm --filter basic-form-wizard tsc --noEmit

# 2. Build successfully  
pnpm --filter basic-form-wizard build

# 3. File size limits
# No single component file > 150 lines
# App.tsx < 50 lines
find src -name "*.tsx" -exec wc -l {} \; | awk '$1 > 150'

# 4. Import validation
# All wizard logic imported from wizard/ folder
grep -r "createWizard\|defineSteps" src --include="*.tsx" | grep -v "wizard/"

# 5. Component separation
# UI components should not import wizard hooks directly
grep -r "useWizard" src/components/ui --include="*.tsx"
```

## Tasks to Complete

1. ✅ Analyze current examples structure
2. ✅ Identify refactoring opportunities  
3. ✅ Research best practices
4. ⏳ Refactor basic-form-wizard
   - [ ] Extract wizard configuration
   - [ ] Create UI component library
   - [ ] Implement useStepForm hook
   - [ ] Split step components
   - [ ] Add proper TypeScript types
5. ⏳ Refactor node-saga-wizard
   - [ ] Separate CLI from saga logic
   - [ ] Extract wizard configuration
   - [ ] Create handler modules
6. ⏳ Implement missing examples
   - [ ] advanced-branching
   - [ ] persistence-local
   - [ ] router-guard-wizard  
   - [ ] zod-validation
7. ⏳ Update documentation
8. ⏳ Run validation gates

## External Resources

### Documentation URLs for AI Agent
- React Patterns: https://react.dev/learn/passing-props-to-a-component
- TypeScript Handbook: https://www.typescriptlang.org/docs/handbook/2/objects.html
- Zod Documentation: https://zod.dev/
- Tailwind CSS: https://tailwindcss.com/docs/reusing-styles
- React Hook Form: https://react-hook-form.com/get-started (for form patterns)

### GitHub Examples to Reference
- shadcn/ui components: https://github.com/shadcn-ui/ui/tree/main/apps/www/components
- React TypeScript patterns: https://github.com/typescript-cheatsheets/react

## Quality Metrics

### Code Quality
- [ ] No file > 150 lines (except test files)
- [ ] All public functions have explicit types
- [ ] Zero TypeScript errors
- [ ] Consistent naming conventions
- [ ] No duplicate code patterns

### Example Quality  
- [ ] Each example has clear purpose
- [ ] README explains what's demonstrated
- [ ] Code comments explain non-obvious logic
- [ ] Can be understood in < 5 minutes

### Maintainability
- [ ] Changes to wizard don't require UI updates
- [ ] UI components are reusable
- [ ] Validation logic is centralized
- [ ] Types are properly exported

## Success Criteria

1. **Developer Experience**
   - New developers understand examples immediately
   - Clear separation makes debugging easier
   - Patterns are easily copied to new projects

2. **Code Metrics**
   - 50% reduction in App.tsx size
   - Zero mixed concerns files
   - 100% TypeScript coverage

3. **Documentation**
   - Each example has clear README
   - Code demonstrates single concept
   - Comments explain wizard-specific logic

## Notes for AI Implementation

- Focus on one example at a time for clarity
- Always run validation gates after changes
- Preserve existing functionality while refactoring
- Use existing patterns from react-router-wizard as reference
- Keep git commits atomic and descriptive
- Test each example manually after refactoring

## Confidence Score: 9/10

High confidence due to:
- Clear existing patterns to follow (react-router-wizard)
- Well-defined TypeScript and React conventions
- Specific file structure and validation gates
- Comprehensive research and context included

Minor uncertainty (-1) for:
- Exact Tailwind utility class patterns without seeing full styling approach
- Potential edge cases in wizard behavior during refactoring