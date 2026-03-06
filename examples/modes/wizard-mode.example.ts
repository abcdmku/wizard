import {
  createOrchestrator,
  defineFlow,
  defineSteps,
  final,
  gate,
  view,
} from '../../core-contracts';

type WizardContext = {
  locale: 'en' | 'fr';
  hasAccount: boolean;
};

const wizardSteps = defineSteps({
  welcome: view({
    runtime: 'client',
    initial: { acceptedIntro: false },
    next: 'account',
  }),
  account: view({
    runtime: 'client',
    initial: { email: '' },
    next: 'accountRoute',
  }),
  accountRoute: gate({
    runtime: 'client',
    next: ({ context }) => (context.hasAccount ? 'profile' : 'createAccount'),
  }),
  createAccount: view({
    runtime: 'client',
    initial: { acceptedTerms: false },
    next: 'profile',
  }),
  profile: view({
    runtime: 'client',
    initial: { firstName: '', lastName: '' },
    next: 'review',
  }),
  review: view({
    runtime: 'client',
    initial: { confirmed: false },
    next: 'done',
  }),
  done: final({
    runtime: 'client',
    next: null,
  }),
});

const wizardFlow = defineFlow({
  mode: 'wizard',
  context: { locale: 'en', hasAccount: false } satisfies WizardContext,
  start: 'welcome',
  steps: wizardSteps,
  final: ['done'],
});

export const wizardOrchestrator = createOrchestrator(wizardFlow);

export async function runWizardExample() {
  await wizardOrchestrator.next();
  await wizardOrchestrator.next();
  await wizardOrchestrator.next();
}
