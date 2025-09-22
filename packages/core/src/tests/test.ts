
import { wizardWithContext } from '@wizard/core';

const { defineSteps, createWizard, step} = wizardWithContext({
  globalFlag: true,
  userId: 'user123',
  permissions: ['read'],
  theme: 'light'
});

const steps = defineSteps({
  step1: step({
    data: { value: 42 },
    canEnter: ({ context, data }) => {
      // ✅ context automatically typed as AppContext
      return context.globalFlag && Boolean(data?.value);
    },
    next: []
  })
});

const wizard = createWizard(steps);

const currentStep = wizard.markError('step1', new Error('Test error'));
const nextStep = wizard.next();