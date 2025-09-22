```tsx
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

wizard.getCurrent();
// typing:
(method) getCurrent(): {
    step: "step1";
    data: Readonly<unknown> | undefined; // this should be defined
    context: Readonly<{
        globalFlag: boolean;
        userId: string;
        permissions: string[];
        theme: string;
    }>;
}


 wizard.getStepData('step1');
 //typing
(method) getStepData<"step1">(step: "step1"): unknown
```

also markIdle, markLoading, markSkipped, markTerminated, setStepData, setStepData (named setData) should be returned from a step as well. for example: wizard.getStepData('step1').markIdle() should be a method. pretty much all method on the wizard should return the new step based off the action. for example const nextStep = wizard.next(); instead of void. also a lot of the helper methods dont make sense to be on the wizard, some should be on a step helper instead.