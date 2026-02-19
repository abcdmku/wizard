import { type DataMapFromDefs } from '@wizard/core';
import {
  createReactWizardFactory,
  type StepComponentProps,
} from '@wizard/react';
import { useEffect } from 'react';
import { z } from 'zod';

type SignupContext = { locale: 'en' | 'fr' };
type ReviewFetchError = TypeError;

const {defineSteps, createWizard, step} = createReactWizardFactory<SignupContext, z.ZodError>();

// Info step
export const infoSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
});

export type InfoInput = ReturnType<typeof infoSchema.parse>;
export type PlanInput = {
  tier: 'free' | 'pro' | 'team';
  seats: number;
};
export type PaymentInput = {
  card: string;
  saveCard: boolean;
};

type SignupStepName = 'info' | 'plan' | 'pay' | 'review';
type SignupStepData = {
  info: InfoInput;
  plan: PlanInput;
  pay: PaymentInput;
  review: { ok: boolean };
};
type SignupStepErrorMap = Record<SignupStepName, z.ZodError | ReviewFetchError>;
type SignupStepProps<K extends SignupStepName> = StepComponentProps<
  SignupContext,
  SignupStepName,
  SignupStepData,
  never,
  K,
  SignupStepErrorMap
>;

const InfoStep = ({ step, data }: SignupStepProps<'info'>) => {
  const { updateData, error } = step;
  return (
    <div>
      <label>Name</label>
      <input value={data?.name} onChange={({target}) => updateData({ name: target.value })}/>
      <span>{error?.message}</span>
    </div>
  )
}

// Plan step
export const planSchema = z.object({
  tier: z.enum(['free', 'pro', 'team']),
  seats: z.number().int().min(1).max(50),
});

const PlanStep = ({ step, data }: SignupStepProps<'plan'>) => {
  const { updateData, error } = step;
  return (
    <div>
      <label>Tier</label>
      <select
        value={data?.tier}
        onChange={({target}) =>
          updateData({ tier: target.value as SignupStepData['plan']['tier'] })
        }
      >
        <option value="free">Free</option>
        <option value="pro">Pro</option>
        <option value="team">Team</option>
      </select>
      <label>Seats</label>
      <input type="number" value={data?.seats} onChange={({target}) => updateData({ seats: +target.value })}/>
      <span>{error?.message}</span>
    </div>
  )
}

// Payment step
export const paymentSchema = z.object({
  card: z.string().regex(/^\d{4}\s\d{4}\s\d{4}\s\d{4}$/, 'Use 16 digits'),
  saveCard: z.boolean(),
});

const PaymentStep = ({ step, data }: SignupStepProps<'pay'>) => {
  const { updateData, error } = step;
  return (
    <div>
      <label>Card</label>
      <input value={data?.card} onChange={({target}) => updateData({ card: target.value })}/>
      <label>Save card?</label>
      <input type="checkbox" checked={data?.saveCard} onChange={({target}) => updateData({ saveCard: target.checked })}/>
      <span>{error?.message}</span>
    </div>
  )
}

const ReviewStep = ({ step, wizard, wizardData }: SignupStepProps<'review'>) => {
  const { error } = step;
  const stepName = step.name;

  useEffect(() => {
    let cancelled = false;

    const mockFetchReview = async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      throw new TypeError('Failed to fetch review data');
    };

    const run = async () => {
      try {
        await mockFetchReview();
      } catch (err) {
        if (cancelled) return;
        wizard.markError(
          stepName,
          err instanceof TypeError
            ? err
            : new TypeError('Failed to fetch review data')
        );
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [stepName, wizard]);
  
  return (<div>
    <h2>Review</h2>
    <pre>{JSON.stringify(wizardData, null, 2)}</pre>
    <span>{error?.message}</span>
  </div>)
}

export const steps = defineSteps({
  info: step<InfoInput>({
    component: InfoStep,
    next: ['plan'],
    validate: ({ data }) => infoSchema.parse(data),
    meta: { label: 'Info' },
  }),
  plan: step({
    component: PlanStep,
    data: { tier: 'pro', seats: 1 },
    next: ['pay'],
    validate: ({ data }) => planSchema.parse(data),
    meta: { label: 'Plan' }
  }),
  pay: step({
    component: PaymentStep,
    data: { card: '', saveCard: true },
    next: ['review'],
    validate: ({ data }) => paymentSchema.parse(data),
    meta: { label: 'Payment' }
  }),
  review: step<{ok: boolean}, ReviewFetchError>({
    component: ReviewStep,
    data: { ok: true },
    meta: { label: 'Done' }
  }),
});

export type SignupDataMap = DataMapFromDefs<typeof steps>;

export const wizard = createWizard(steps, { context: { locale: 'fr' }});
