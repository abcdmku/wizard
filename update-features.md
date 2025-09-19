I want to have the wizard infer most types by default. optionally you should be able to define typings as well like the current state:

```tsx
type Context = { userId: string };
type Steps = 'info' | 'payment' | 'confirm';
type Data = {
  info: { name: string; email: string };
  payment: { method: string; amount: number };
  confirm: { agreed: boolean };
};
 
const wizard = createWizard<Context, Steps, Data>({
  initialStep: 'info',
  initialContext: { userId: '123' },
  steps: {
    info: { next: 'payment' },
    payment: { next: 'confirm' },
    confirm: {}
  }
});
```

i want to support something like this syntax as well:

```tsx
import { createWizard } from "@wizard/core";
import { z } from "zod";

type infoData = { name: string; email: string }

const paymentDataSchema = z.object({
    method: z.string(),
    amount: z.number().positive(),
});

const wizard = createWizard({
  initialStep: 'info',
  initialContext: { userId: '123' },
  steps: {
    info: { next: ['payment'], load: () => ({ name: '', email: '' }) as infoData }, // look in to if theres a better syntax. the goal is to have the wizard infer the types from each step
    payment: { 
      next: ['confirm'], 
      validate: (data) => paymentDataSchema.parse(data), // refine this syntax but validation should also define data type for a step as well
        
    },
    confirm: {
      next: [],
    }
  }
});

wizard.getStepData('payment'); // should return as paymentData type
wizard.getStepData('info'); // should return as infoData type
```