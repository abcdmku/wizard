# Node Saga Wizard Example

This example demonstrates wizard usage in a Node.js CLI environment with an order processing saga and **modern terminal UI**.

## What This Example Demonstrates

- **Non-React Usage**: Pure Node.js implementation without UI framework
- **Saga Pattern**: Multi-step order processing workflow
- **Modern CLI**: Beautiful terminal UI with colors, spinners, and progress bars
- **Interactive & Automated Modes**: Choose your workflow
- **Error Handling**: Compensation logic for failed steps
- **Clean Architecture**: Separated concerns across modules

## Structure

```
src/
├── index.ts                   # Entry point
├── wizard/
│   ├── orderWizard.ts         # Wizard configuration
│   ├── factory.ts             # Wizard factory with types
│   ├── types.ts               # Type definitions
│   └── validation.ts          # Zod schemas
├── saga/
│   ├── automated.ts           # Automated flow with beautiful UI
│   └── handlers.ts            # Step handlers
└── cli/
    ├── interactive.ts         # Interactive CLI with modern prompts
    └── display.ts             # Terminal UI utilities
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
- **Clean TUI** powered by [readline-sync](https://www.npmjs.com/package/readline-sync)
- **Zero keystroke spam** - only shows final input values
- Built-in email validation
- Simple Y/N confirmations
- Select menus for choices
- Beautiful visual feedback with spinners and progress bars
- Clean, predictable terminal output
- **Note**: Requires an interactive terminal (TTY). Will not work with piped input.

#### Automated Mode
```bash
pnpm start auto
```
- Runs through the entire saga automatically with test data
- Animated ASCII art title
- Real-time progress indicators
- Colored success/error messages
- Beautiful summary box at completion

### Clean Separation

- **wizard/**: Configuration and validation
- **saga/**: Business logic and handlers
- **cli/**: User interaction layer

## Running the Example

```bash
# Install dependencies (from repo root)
pnpm install

# Run interactive mode (requires TTY)
pnpm start

# Run automated mode (perfect for CI/CD)
pnpm start auto
# or
pnpm start:auto
# or
pnpm test

# Build TypeScript
pnpm build

# Type check
pnpm typecheck

# Development mode with watch
pnpm dev
```

### CI/CD Friendly

The automated mode is perfect for CI/CD pipelines since it doesn't require user input:

```yaml
# GitHub Actions example
- name: Test Node Saga Wizard
  run: |
    cd examples/node-saga-wizard
    pnpm test
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

## Modern Terminal UI

This example showcases a modern CLI experience using:

- **[prompts](https://www.npmjs.com/package/prompts)** - Clean, minimal terminal prompts (TUI)
- **[chalk](https://www.npmjs.com/package/chalk)** - Terminal string styling
- **[ora](https://www.npmjs.com/package/ora)** - Elegant terminal spinners
- **[boxen](https://www.npmjs.com/package/boxen)** - Create boxes in the terminal
- **[cli-table3](https://www.npmjs.com/package/cli-table3)** - Pretty unicode tables
- **[gradient-string](https://www.npmjs.com/package/gradient-string)** - Beautiful gradients
- **[figlet](https://www.npmjs.com/package/figlet)** - ASCII art text

The `cli/display.ts` module provides reusable utilities:
- `showTitle()` - Animated ASCII art titles
- `showBanner()` - Boxed messages with colors
- `showProgress()` - Visual progress bars
- `createSpinner()` - Loading spinners
- `showSummary()` - Data display boxes
- `showSuccess/Error/Warning/Info()` - Colored status messages

## Usage Pattern

This example shows how to:
- Build wizards without React
- Implement saga patterns
- Handle async operations in steps
- Provide both interactive and automated modes
- Structure Node.js CLI applications
- Create beautiful terminal UIs similar to modern dev tools like Claude Code