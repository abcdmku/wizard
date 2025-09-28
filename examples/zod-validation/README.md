# Zod Validation Wizard Example

This example demonstrates comprehensive form validation using Zod schemas with the factory pattern.

## Features

- **Zod Schema Validation**: Each step has a corresponding Zod schema
- **Real-time Field Validation**: Validate individual fields as users type
- **Step-level Validation**: Validate entire forms before proceeding
- **Custom Validation Rules**: Using Zod's `.refine()` for business logic
- **Error Aggregation**: Collect and display validation errors in context
- **Type Safety**: Full TypeScript types inferred from Zod schemas

## Validation Examples

### Basic Field Validation
- String length constraints (min/max)
- Email format validation
- Number range validation
- Regex patterns (ZIP codes)

### Complex Validation
- Nested object validation (notification preferences)
- Enum validation (theme, language)
- Custom refinements (terms acceptance)
- Conditional validation rules

## Setup

```bash
pnpm install
pnpm dev
```

## Flow

1. **Personal Info**: Name, email, age validation
2. **Address**: Street, city, state, ZIP validation
3. **Preferences**: Boolean and enum validations
4. **Review**: Required consent checkboxes

## Key Components

- `ValidationStatus`: Real-time validation error display
- `StepIndicator`: Visual progress with error states
- Zod schemas in `wizard/types.ts`
- Factory pattern for type-safe context