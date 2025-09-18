# Progress-Oriented Wizard Example

This example demonstrates a wizard with comprehensive progress tracking, weighted steps, and status management.

## Use Case

A multi-step onboarding flow with:
- Optional and required steps
- Weighted progress calculation
- Error recovery
- Skip functionality

## Implementation

```typescript
import { createWizard, type WizardConfig, type StepStatus } from '@wizard/core';

// Types
type OnboardingContext = {
  userId: string | null;
  accountType: 'personal' | 'business' | null;
  hasPaymentMethod: boolean;
};

type OnboardingSteps =
  | 'welcome'
  | 'account-type'
  | 'profile'
  | 'business-details'  // Optional - only for business accounts
  | 'payment'           // Optional - can skip for free tier
  | 'preferences'
  | 'tutorial'          // Optional - can skip
  | 'complete';

type StepData = {
  welcome: { agreed: boolean };
  'account-type': { type: 'personal' | 'business' };
  profile: { name: string; email: string; phone?: string };
  'business-details': { companyName: string; taxId: string };
  payment: { method: 'card' | 'bank'; last4: string };
  preferences: { notifications: boolean; theme: 'light' | 'dark' };
  tutorial: { completed: boolean };
  complete: { timestamp: number };
};

// Configuration
const wizardConfig: WizardConfig<OnboardingContext, OnboardingSteps, StepData> = {
  initialStep: 'welcome',
  initialContext: {
    userId: null,
    accountType: null,
    hasPaymentMethod: false
  },

  // Define explicit order
  order: [
    'welcome',
    'account-type',
    'profile',
    'business-details',
    'payment',
    'preferences',
    'tutorial',
    'complete'
  ],

  // Weight important steps more heavily
  weights: {
    'welcome': 1,
    'account-type': 2,
    'profile': 3,        // Most important
    'business-details': 2,
    'payment': 3,        // Most important
    'preferences': 1,
    'tutorial': 1,
    'complete': 1
  },

  // Define prerequisites
  prerequisites: {
    'profile': ['account-type'],
    'business-details': ['account-type'],
    'payment': ['profile'],
    'preferences': ['profile'],
    'complete': ['preferences']
  },

  // Dynamic optional/required logic
  isOptional: (step, ctx) => {
    switch (step) {
      case 'business-details':
        return ctx.accountType !== 'business';
      case 'payment':
        return true; // Always optional, can add later
      case 'tutorial':
        return true; // Can skip tutorial
      default:
        return false;
    }
  },

  // Custom completion logic
  isStepComplete: ({ step, data, ctx }) => {
    switch (step) {
      case 'business-details':
        // Only complete if business account and data provided
        if (ctx.accountType !== 'business') return true;
        return !!data['business-details']?.companyName;
      case 'payment':
        // Mark complete if skipped or has data
        return ctx.hasPaymentMethod || !!data.payment?.last4;
      default:
        return data[step] != null;
    }
  },

  // Track status changes
  onStatusChange: ({ step, prev, next }) => {
    console.log(`[${step}] Status: ${prev} → ${next}`);

    // Send analytics
    if (next === 'completed') {
      analytics.track('Step Completed', { step });
    } else if (next === 'error') {
      analytics.track('Step Error', { step });
    } else if (next === 'skipped') {
      analytics.track('Step Skipped', { step });
    }
  },

  // Step definitions
  steps: {
    'welcome': {
      next: ['account-type'],
      validate: (data) => {
        if (!data.agreed) throw new Error('Must agree to terms');
      }
    },

    'account-type': {
      next: ['profile'],
      beforeExit: async ({ data, updateContext }) => {
        updateContext(ctx => {
          ctx.accountType = data.type;
        });
      }
    },

    'profile': {
      next: ({ ctx }) => {
        // Dynamic routing based on account type
        if (ctx.accountType === 'business') {
          return ['business-details'];
        }
        return ['payment'];
      },
      validate: (data) => {
        if (!data.email || !data.name) {
          throw new Error('Name and email are required');
        }
      },
      beforeExit: async ({ data, updateContext }) => {
        // Simulate API call
        const userId = await createUser(data);
        updateContext(ctx => {
          ctx.userId = userId;
        });
      }
    },

    'business-details': {
      next: ['payment'],
      canEnter: ({ ctx }) => ctx.accountType === 'business',
      validate: (data) => {
        if (!data.companyName || !data.taxId) {
          throw new Error('Business details required');
        }
      }
    },

    'payment': {
      next: ['preferences'],
      beforeExit: async ({ data, updateContext }) => {
        if (data) {
          updateContext(ctx => {
            ctx.hasPaymentMethod = true;
          });
        }
      }
    },

    'preferences': {
      next: ['tutorial']
    },

    'tutorial': {
      next: ['complete'],
      load: async ({ setStepData }) => {
        // Auto-mark as complete after viewing
        setTimeout(() => {
          setStepData({ completed: true });
        }, 3000);
      }
    },

    'complete': {
      next: [],
      load: async ({ setStepData }) => {
        setStepData({ timestamp: Date.now() });
      }
    }
  }
};

// Create wizard instance
const wizard = createWizard(wizardConfig);

// Example usage functions

/**
 * Smart progress component
 */
function getProgressInfo() {
  const { percent, label } = wizard.helpers.progress();
  const remaining = wizard.helpers.remainingRequiredCount();
  const current = wizard.getCurrent().step;
  const status = wizard.helpers.stepStatus(current);

  return {
    percent,
    label,
    remaining,
    status,
    isStalled: status === 'error' || status === 'terminated',
    canContinue: wizard.helpers.canGoNext()
  };
}

/**
 * Get step list with full metadata
 */
function getStepsWithStatus() {
  return wizard.helpers.orderedSteps().map(step => {
    const status = wizard.helpers.stepStatus(step);
    const isOptional = wizard.helpers.isOptional(step);
    const isAvailable = wizard.helpers.canGoTo(step);
    const attempts = wizard.helpers.stepAttempts(step);

    return {
      id: step,
      status,
      isOptional,
      isAvailable,
      attempts,
      canSkip: isOptional && status !== 'completed',
      needsRetry: status === 'error' && attempts < 3
    };
  });
}

/**
 * Handle step errors with retry logic
 */
async function handleStepWithRetry(step: OnboardingSteps, data: any) {
  const maxAttempts = 3;
  const attempts = wizard.helpers.stepAttempts(step);

  try {
    wizard.markLoading(step);
    await wizard.goTo(step, { data });
    wizard.markIdle(step);
  } catch (error) {
    wizard.markIdle(step);

    if (attempts >= maxAttempts) {
      wizard.markTerminated(step, error);

      // Check if step is optional
      if (wizard.helpers.isOptional(step)) {
        // Skip and continue
        wizard.markSkipped(step);
        const next = wizard.helpers.findNextAvailable();
        if (next) {
          await wizard.goTo(next);
        }
      }
    } else {
      wizard.markError(step, error);
      throw error; // Let UI handle retry
    }
  }
}

/**
 * Skip remaining optional steps
 */
async function skipToCompletion() {
  const current = wizard.getCurrent().step;
  const remaining = wizard.helpers.remainingSteps();

  for (const step of remaining) {
    if (wizard.helpers.isOptional(step) &&
        wizard.helpers.stepStatus(step) !== 'completed') {
      wizard.markSkipped(step);
    }
  }

  // Jump to next required or complete
  const nextRequired = wizard.helpers.jumpToNextRequired();
  if (nextRequired) {
    await wizard.goTo(nextRequired);
  } else {
    // All required done, go to complete
    const steps = wizard.helpers.orderedSteps();
    const lastStep = steps[steps.length - 1];
    if (wizard.helpers.canGoTo(lastStep)) {
      await wizard.goTo(lastStep);
    }
  }
}

/**
 * Generate progress report
 */
function generateProgressReport() {
  const completed = wizard.helpers.completedSteps();
  const skipped = wizard.helpers.orderedSteps()
    .filter(s => wizard.helpers.stepStatus(s) === 'skipped');
  const failed = wizard.helpers.orderedSteps()
    .filter(s => ['error', 'terminated'].includes(wizard.helpers.stepStatus(s)));

  const stepTimes = wizard.helpers.orderedSteps()
    .map(step => ({
      step,
      duration: wizard.helpers.stepDuration(step)
    }))
    .filter(s => s.duration !== null);

  const totalTime = stepTimes.reduce((sum, s) => sum + (s.duration || 0), 0);

  return {
    completedSteps: completed.length,
    skippedSteps: skipped.length,
    failedSteps: failed.length,
    totalTime: totalTime,
    averageStepTime: totalTime / (stepTimes.length || 1),
    completionRate: wizard.helpers.progress().percent,
    isFullyComplete: wizard.helpers.isComplete(),
    stepBreakdown: wizard.helpers.percentCompletePerStep()
  };
}

// Export for use
export { wizard, getProgressInfo, getStepsWithStatus, handleStepWithRetry, skipToCompletion, generateProgressReport };
```

## React Component Example

```tsx
import React, { useState, useEffect } from 'react';
import { wizard, getStepsWithStatus, getProgressInfo } from './onboarding-wizard';

function OnboardingProgress() {
  const [progress, setProgress] = useState(getProgressInfo());
  const [steps, setSteps] = useState(getStepsWithStatus());

  useEffect(() => {
    const unsubscribe = wizard.subscribe(() => {
      setProgress(getProgressInfo());
      setSteps(getStepsWithStatus());
    });

    return unsubscribe;
  }, []);

  return (
    <div className="onboarding-container">
      {/* Progress Bar */}
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
        <span className="progress-label">{progress.label}</span>
        {progress.remaining > 0 && (
          <span className="remaining">{progress.remaining} required steps left</span>
        )}
      </div>

      {/* Step List */}
      <div className="step-list">
        {steps.map(step => (
          <div
            key={step.id}
            className={`step step--${step.status} ${step.isOptional ? 'step--optional' : ''}`}
          >
            <div className="step-header">
              <span className="step-name">{step.id}</span>
              {step.isOptional && <span className="badge">Optional</span>}
              {step.status === 'error' && <span className="badge badge--error">Failed</span>}
              {step.attempts > 1 && <span className="attempts">Attempt {step.attempts}</span>}
            </div>

            <div className="step-actions">
              {step.canSkip && (
                <button onClick={() => wizard.markSkipped(step.id)}>
                  Skip
                </button>
              )}
              {step.needsRetry && (
                <button onClick={() => wizard.goTo(step.id)}>
                  Retry
                </button>
              )}
              {step.isAvailable && step.status !== 'current' && (
                <button onClick={() => wizard.goTo(step.id)}>
                  Go to step
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Navigation */}
      <div className="navigation">
        <button
          onClick={() => wizard.back()}
          disabled={!wizard.helpers.canGoBack()}
        >
          Back
        </button>

        <button
          onClick={() => wizard.next()}
          disabled={!wizard.helpers.canGoNext()}
        >
          Next
        </button>

        {progress.remaining > 0 && wizard.helpers.jumpToNextRequired() && (
          <button
            onClick={() => {
              const next = wizard.helpers.jumpToNextRequired();
              if (next) wizard.goTo(next);
            }}
          >
            Skip to next required
          </button>
        )}
      </div>

      {/* Stalled indicator */}
      {progress.isStalled && (
        <div className="alert alert--warning">
          The current step has failed. Please retry or skip if optional.
        </div>
      )}
    </div>
  );
}
```

## Key Features Demonstrated

1. **Weighted Progress**: Important steps (profile, payment) have higher weights
2. **Dynamic Routing**: Route changes based on account type
3. **Optional Steps**: Business details only for business accounts
4. **Error Recovery**: Retry logic with max attempts
5. **Skip Functionality**: Can skip optional steps
6. **Status Tracking**: Comprehensive status for each step
7. **Analytics Integration**: Track user progress
8. **Progress Reporting**: Generate detailed progress reports