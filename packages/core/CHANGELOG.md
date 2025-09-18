# Changelog

All notable changes to @wizard/core will be documented in this file.

## [0.1.0] - 2024-01-17

### Added

#### Status System
- **9 Step Statuses**: Comprehensive status tracking with `unavailable`, `optional`, `current`, `completed`, `required`, `skipped`, `error`, `terminated`, and `loading` states
- **Status Management Methods**: New methods to programmatically control step statuses
  - `markError(step, error)` - Mark step with retryable error
  - `markTerminated(step, error?)` - Mark step as permanently failed
  - `markLoading(step)` - Mark step as loading
  - `markIdle(step)` - Clear loading state
  - `markSkipped(step)` - Mark step as skipped

#### Configuration Options
- **Step Ordering**: `order` option for explicit step sequence
- **Progress Weighting**: `weights` option for weighted progress calculation
- **Prerequisites**: `prerequisites` option for DAG-based step dependencies
- **Completion Check**: `isStepComplete` function for custom completion logic
- **Optional/Required**: `isOptional` and `isRequired` functions for step classification
- **Status Hook**: `onStatusChange` callback for status transitions

#### Helper Methods
- **Identity & Ordering**
  - `allSteps()` - Get all declared steps
  - `orderedSteps()` - Get steps in configured order
  - `stepCount()` - Total number of steps
  - `stepIndex(step)` - Get index of specific step
  - `currentIndex()` - Get current step index

- **Status & Classification**
  - `stepStatus(step)` - Get current status of a step
  - `isOptional(step)` - Check if step is optional
  - `isRequired(step)` - Check if step is required

- **Availability**
  - `availableSteps()` - Get currently accessible steps
  - `unavailableSteps()` - Get blocked steps
  - `refreshAvailability()` - Re-evaluate async guards

- **Progress & Completion**
  - `completedSteps()` - Get finished steps
  - `remainingSteps()` - Get steps after current
  - `firstIncompleteStep()` - Find first unfinished step
  - `lastCompletedStep()` - Find last finished step
  - `remainingRequiredCount()` - Count of required steps left
  - `isComplete()` - Check if all required steps done
  - `progress()` - Get progress metrics (ratio, percent, label)

- **Navigation**
  - `canGoNext()` - Check if can proceed
  - `canGoBack()` - Check if can go back
  - `canGoTo(step)` - Check if can jump to specific step
  - `findNextAvailable()` - Find next accessible step
  - `findPrevAvailable()` - Find previous accessible step
  - `jumpToNextRequired()` - Find next required step

- **Graph & Prerequisites**
  - `isReachable(step)` - Check if step can be reached
  - `prerequisitesFor(step)` - Get step prerequisites
  - `successorsOf(step)` - Get possible next steps

- **Diagnostics**
  - `stepAttempts(step)` - Get retry count for step
  - `stepDuration(step)` - Get time spent on step
  - `percentCompletePerStep()` - Get completion percentage map

#### Runtime Tracking
- **Step Runtime Data**: Track attempts, timestamps, and status overrides
- **Automatic Tracking**: Start time and attempt count tracked on step entry

#### Pure Selectors
- **Tree-shakable Functions**: Standalone selector functions for state queries
- **Import Optimization**: Can import only needed selectors

### Changed
- **WizardState**: Added optional `runtime` field for tracking step metadata
- **Type Exports**: Now exports `StepStatus`, `StepRuntime`, `WizardHelpers`, and `StepMeta` types

### Technical Details
- Bundle size impact: ~0.5KB additional minified
- No breaking changes - all new features are opt-in
- Full TypeScript support with literal type preservation
- SSR-safe implementation
- Zero additional dependencies

## [0.0.1] - Initial Release

### Added
- Core wizard functionality
- Type-safe step management
- Shared context system
- Guards and validation
- History and undo support
- Persistence interface
- React adapter support