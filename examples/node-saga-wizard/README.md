# Node Saga Wizard Example

This example demonstrates wizard usage in a Node.js CLI environment with an order processing saga.

## What This Example Demonstrates

- **Non-React Usage**: Pure Node.js implementation without UI framework
- **Saga Pattern**: Multi-step order processing workflow
- **CLI Interaction**: Interactive and automated modes
- **Error Handling**: Compensation logic for failed steps
- **Clean Architecture**: Separated concerns across modules

## Structure

```
src/
├── index.ts                   # Entry point (21 lines)
├── wizard/
│   ├── orderWizard.ts         # Wizard configuration (93 lines)
│   ├── types.ts               # Type definitions (54 lines)
│   └── validation.ts          # Zod schemas (26 lines)
├── saga/
│   ├── automated.ts           # Automated flow (76 lines)
│   └── handlers.ts            # Step handlers (89 lines)
└── cli/
    └── interactive.ts         # Interactive CLI (84 lines)
```

## Key Features

### Order Processing Steps
1. **Initialize**: Create order with customer details
2. **Reserve**: Reserve inventory for items
3. **Charge**: Process payment
4. **Notify**: Send confirmation email
5. **Complete**: Finalize order

### Two Execution Modes

#### Interactive Mode (default)
```bash
pnpm start
```
Prompts user for input at each step.

#### Automated Mode
```bash
pnpm start auto
```
Runs through the entire saga automatically with test data.

### Clean Separation

- **wizard/**: Configuration and validation
- **saga/**: Business logic and handlers
- **cli/**: User interaction layer

## Running the Example

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Run interactive mode
pnpm start

# Run automated mode  
pnpm start auto
```

## Code Organization

### Step Handlers
Each step's business logic is isolated in `saga/handlers.ts`:
- Async operations (API calls, DB operations)
- Context updates
- Success/error messaging

### Validation
Using Zod schemas for type-safe validation:
- Runtime validation
- TypeScript type inference
- Clear error messages

### Wizard Helpers
Demonstrates usage of wizard helpers:
- `progress()`: Track completion percentage
- `completedSteps()`: List finished steps
- `remainingSteps()`: Show what's left
- `canGoNext()`: Check if progression is allowed

## Saga Pattern Benefits

1. **Transaction-like Flow**: Each step can be rolled back
2. **Error Recovery**: Compensation logic for failures
3. **State Persistence**: Could easily add database persistence
4. **Audit Trail**: Each step is logged
5. **Async Operations**: Steps can perform long-running tasks

## Usage Pattern

This example shows how to:
- Build wizards without React
- Implement saga patterns
- Handle async operations in steps
- Provide both interactive and automated modes
- Structure Node.js CLI applications