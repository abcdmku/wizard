# Router Guard Wizard Example

This example demonstrates advanced navigation guards and step protection in wizard flows.

## Features

- **Authentication Guards**: Protect steps that require login
- **Exit Guards**: Warn users about unsaved changes
- **Step Locking**: Lock all steps after final confirmation
- **Dynamic Context**: Track authentication state and completed steps
- **Visual Indicators**: Show guard status and step states

## Guard Types

### canEnter Guards
- Check if user can access a step
- Used for authentication requirements
- Prevent access to locked steps

### canExit Guards  
- Validate before leaving a step
- Warn about unsaved changes
- Prevent navigation after confirmation

## Setup

```bash
pnpm install
pnpm dev
```

## Flow

1. **Introduction**: Welcome step with exit warning
2. **Authentication**: Login required (sets auth state)
3. **Secure Data**: Protected step requiring authentication
4. **Confirmation**: Final step that locks all navigation

## Key Components

- `GuardStatus`: Shows current authentication and lock states
- `StepIndicator`: Visual progress with lock indicators
- Guard callbacks in wizard configuration