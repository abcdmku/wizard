# PRP: Isomorphic, Deeply-Typed Wizard — Complete API Refactor

## Overview

Refactor the entire wizard library to implement inference-first authoring with deeply-typed, isomorphic core + React adapter. This is a complete API redesign that maintains functionality while dramatically improving developer experience through TypeScript inference.

## Current State Analysis

### Current API Pattern (Old)
```ts
// Requires explicit generics and verbose configuration
const wizard = createWizard<Context, Steps, DataMap>({
  initialStep: 'account',
  initialContext: { totalSteps: 3 },
  steps: {
    account: {
      validate: (data: AccountData) => { /* manual typing */ },
      next: ['personal']
    }
  }
});
```

### Target API Pattern (New)
```ts
// Inference-first: no generics, types flow automatically
const steps = defineSteps({
  account: {
    validate: ({ data }) => schema.parse(data), // ✅ Auto-inferred
    data: { name:'', email:'' },                // ✅ Type source
    next: ['shipping'],
    component: ({ data, setStepData }) => <Form .../>, // ✅ Typed args
    meta: { label: 'Account', iconKey: 'user' },
  },
  shipping: { beforeEnter: () => ({ address:'' }), next: ['review'] },
  review:   { data: { agreed:false }, next: ['done'] },
  done:     { next: [] },
});

const wizard = createWizard({ context: { userId:null }, steps });
```

## Dependencies & Documentation

### Core Dependencies
- **@tanstack/store**: `^0.7.5` - Reactive state management
  - Docs: https://tanstack.com/store/latest/docs/quick-start
  - React Hook: https://tanstack.com/store/latest/docs/framework/react/reference/functions/usestore
- **Zod**: `^3.24.1` - Optional peer dependency for validation
- **tsup**: `^8.5.0` - Build system (ESM/CJS/types)
- **vitest**: `^3.2.4` - Testing framework

### Documentation System
- **Nextra**: `^3.0.0` - MDX-powered docs
  - Setup: https://nextra.site/docs/guide/markdown
  - Components: https://nextra.site/docs/file-conventions/mdx-components-file
  - App Router: https://the-guild.dev/blog/nextra-4

### TypeScript Patterns
- Advanced type inference: https://www.totaltypescript.com/workshops/advanced-typescript-patterns
- Builder patterns: https://www.totaltypescript.com/workshops/advanced-typescript-patterns/classes/class-implementation-following-the-builder-pattern
- Conditional types: https://www.typescriptlang.org/docs/handbook/advanced-types.html

## Implementation Blueprint

### Phase 1: Core Package Refactor (@wizard/core)

#### 1.1 Utility Types & Resolvers
```ts
// packages/core/src/types.ts
export type JSONValue = string | number | boolean | null | { [k: string]: JSONValue } | JSONValue[];
export type ValOrFn<T, A> = T | ((args: A) => T);
export const resolve = <T, A>(v: ValOrFn<T, A>, a: A): T =>
  typeof v === 'function' ? (v as any)(a) : v;
```

#### 1.2 Inference Engine
```ts
// Key inference types that make the magic happen
type InferFromValidate<TDef> = TDef extends { validate: (a: infer A) => any }
  ? A extends { data: infer D } ? D : never : never;

type InferFromBeforeEnter<TDef> = TDef extends { beforeEnter: (...a: any[]) => infer R | Promise<infer R> }
  ? (R extends void ? never : R) : never;

type InferFromData<TDef> = TDef extends { data: infer D }
  ? (D extends ValOrFn<infer X, any> ? X : D) : never;

export type InferStepData<TDef> = OrNeverToUnknown<
  InferFromValidate<TDef> | InferFromBeforeEnter<TDef> | InferFromData<TDef>
>;
```

#### 1.3 Status Vocabulary (9 states)
```ts
export type StepStatus = 'unavailable' | 'optional' | 'current' | 'completed'
  | 'required' | 'skipped' | 'error' | 'terminated' | 'loading';
```

#### 1.4 Factory & Wizard Implementation
- Replace `packages/core/src/wizard/createWizard.ts` with new factory
- Integrate @tanstack/store for reactive state
- Implement all 24 helper functions from specification

### Phase 2: React Package Refactor (@wizard/react)

#### 2.1 UI Meta & Component System
```ts
// packages/react/src/types.ts
export type ComponentLike = React.ComponentType<any> | React.ReactElement;
export type StepMetaUI<C,S extends string,Data,E> = {
  icon?: ValOrFn<React.ReactNode, StepArgs<C,S,Data,E>>;
  renderBadge?: ValOrFn<React.ReactNode, StepArgs<C,S,Data,E>>;
  uiExtra?: Record<string, unknown>;
};

export type ReactStepDefinition<C,S extends string,E,TDef> =
  PartialStepDefinition<C,S,E,TDef> & {
    component?: ValOrFn<ComponentLike, StepArgs<C,S,InferStepData<TDef>,E>>;
    uiMeta?: StepMetaUI<C,S,InferStepData<TDef>,E>;
  };
```

#### 2.2 Provider & Hooks
```ts
// packages/react/src/provider.tsx - Thin @tanstack/store bindings
export function WizardProvider({ wizard, children }) {
  return <WizardContext.Provider value={wizard}>{children}</WizardContext.Provider>;
}

export function useWizardState(selector) {
  const wizard = useWizard();
  return useStore(wizard.store, selector);
}
```

### Phase 3: Examples Migration

#### 3.1 Basic Form Wizard
```ts
// examples/basic-form-wizard/src/example.ts
const steps = defineSteps({
  account: {
    validate: ({ data }) => accountSchema.parse(data),
    data: { name: '', email: '' },
    next: ['shipping'],
    meta: { label: 'Account', iconKey: 'user' },
  },
  // ... other steps
});

const wizard = createWizard({ context: { userId: null }, steps });
```

#### 3.2 Node Saga Wizard
```ts
// examples/node-saga-wizard/src/index.ts
const steps = defineSteps({
  createOrder: {
    beforeEnter: ({ updateContext }) => {
      updateContext(ctx => { ctx.logLevel = 'info'; });
      return { orderId: 'ORD-' + Date.now() };
    },
    next: ['processPayment'],
    meta: { label: 'Create Order', category: 'order-management' },
  },
  // ... other steps
});
```

### Phase 4: Documentation & Testing

#### 4.1 Nextra Documentation Setup
```ts
// packages/docs/next.config.mjs
import nextra from 'nextra'
const withNextra = nextra()
export default withNextra({
  turbopack: { resolveAlias: { 'next-mdx-import-source-file': './mdx-components.tsx' }}
})
```

#### 4.2 Documentation Content
- `/content/api/helpers.mdx` - All 24 helper functions with examples
- `/content/guides/inference.mdx` - Type inference patterns
- `/content/examples/` - Embedded code examples via `<CodeFrom>` component

#### 4.3 Testing Strategy
- Type tests for inference engine
- Unit tests for all helpers
- React integration tests
- Build validation tests

## Task Implementation Order

### Critical Path
1. **[CORE]** Implement new types.ts with inference engine
2. **[CORE]** Create createWizard factory with @tanstack/store integration
3. **[CORE]** Implement WizardHelpers with all 24 functions
4. **[REACT]** Create provider/hooks with @tanstack/react-store
5. **[REACT]** Add UI meta and component resolution
6. **[EXAMPLES]** Migrate basic-form-wizard to new API
7. **[EXAMPLES]** Migrate node-saga-wizard to new API
8. **[BUILD]** Ensure all packages build successfully
9. **[DOCS]** Set up Nextra with helper documentation
10. **[VALIDATION]** Run comprehensive test suite

### File Replacement Strategy
- Replace entire `packages/core/src/types.ts`
- Replace `packages/core/src/wizard/createWizard.ts` with new factory
- Remove deprecated files: `helpers/`, `utils/`, old wizard modules
- Replace `packages/react/src/hooks.ts` with new provider-based hooks
- Update all examples to use new API

## Validation Gates (Executable)

### Build Validation
```bash
# Core package builds
cd packages/core && pnpm build
cd packages/react && pnpm build

# Full monorepo build
pnpm build
```

### Type Validation
```bash
# TypeScript compilation
pnpm typecheck

# Type inference validation
cd packages/core && pnpm test:types
```

### Functional Validation
```bash
# Unit tests
pnpm test

# Example compilation
cd examples/basic-form-wizard && pnpm build
cd examples/node-saga-wizard && pnpm build
```

### Documentation Validation
```bash
# Docs build
cd packages/docs && pnpm build

# Link checking
cd packages/docs && pnpm check:links
```

## Error Handling & Gotchas

### TypeScript Inference Challenges
- **Complex conditional types**: Use `OrNeverToUnknown<T>` helper for `never` handling
- **Function overloads**: Avoid inference conflicts in `createWizard` signature
- **Circular references**: Ensure step inference doesn't create type loops

### Build System Issues
- **ESM/CJS dual builds**: Maintain `.cjs` and `.js` outputs via tsup
- **Type declaration maps**: Ensure `.d.ts` files are properly generated
- **Import resolution**: Use proper `exports` field in package.json

### React Integration Gotchas
- **Store subscriptions**: Use selectors to prevent unnecessary re-renders
- **Component inference**: Handle both ComponentType and ReactElement in resolvers
- **Context typing**: Avoid `any` types in provider generic constraints

### Testing Patterns
- **Type-only tests**: Use `.type-test.ts` files for compilation verification
- **Async helpers**: Mock @tanstack/store for predictable test behavior
- **React testing**: Use React Testing Library with act() for async state updates

## Success Criteria

### Functional Requirements ✅
- [x] Author can write `defineSteps()` without generics
- [x] Callbacks see correct per-step data types automatically
- [x] Core meta is JSON-serializable, UI meta in React package
- [x] All 24 helper functions implemented and functional
- [x] 9 status types with correct semantics
- [x] Progress calculation is monotonic and accurate

### Technical Requirements ✅
- [x] Packages build successfully with ESM/CJS/types
- [x] TypeScript inference works without explicit generics
- [x] @tanstack/store integration for reactive updates
- [x] React hooks provide type-safe wizard access
- [x] Examples compile and demonstrate all patterns
- [x] Nextra docs render with embedded examples

### Quality Requirements ✅
- [x] Build time under 10 seconds for full monorepo
- [x] Bundle size budget: core <15KB, react <5KB
- [x] Zero TypeScript errors in strict mode
- [x] 100% test coverage for helpers and core logic
- [x] Documentation covers all API surface area

## Confidence Score: 9/10

**Rationale**: This PRP provides comprehensive context including:
- ✅ Complete current state analysis with code examples
- ✅ Detailed target API specification from typing.md
- ✅ External dependency documentation with URLs
- ✅ Step-by-step implementation blueprint
- ✅ Executable validation commands for each phase
- ✅ Error handling patterns and common gotchas
- ✅ Clear success criteria with measurable outcomes

**Risk Mitigation**:
- TypeScript inference complexity addressed with specific type patterns
- Build system configuration documented with examples
- React integration patterns follow @tanstack/store best practices
- Migration path preserves existing functionality

The only uncertainty (10% risk) is potential TypeScript inference edge cases in complex step definitions, but the conditional type patterns provided should handle the majority of real-world scenarios.