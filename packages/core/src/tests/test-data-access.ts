import { wizardWithContext } from '../wizard-factory';

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
      return context.globalFlag && Boolean(data?.value);
    },
    next: []
  })
});

const wizard = createWizard(steps);

const currentStep = wizard.getStep('step1');

// This should show the specific error about data.value access
const value = currentStep.data.value;

console.log('Value:', value);