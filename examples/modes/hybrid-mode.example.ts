import {
  action,
  createOrchestrator,
  defineFlow,
  defineSteps,
  final,
  gate,
  view,
} from '../../core-contracts';

type HybridContext = {
  cartId: string;
  orderTotal: number;
};

const hybridSteps = defineSteps({
  cart: view({
    runtime: 'client',
    initial: { items: [] as string[] },
    next: 'shipping',
  }),
  shipping: view({
    runtime: 'client',
    dependsOn: ['cart'],
    initial: { address: '' },
    next: 'approvalGate',
  }),
  approvalGate: gate({
    runtime: 'server',
    dependsOn: ['shipping'],
    run: async ({ context }) => ({ approved: context.orderTotal > 0 }),
    next: ({ output }) => (output?.approved ? 'reserveInventory' : 'declined'),
  }),
  reserveInventory: action({
    runtime: 'server',
    dependsOn: ['approvalGate'],
    run: async ({ context }) => ({ reservationId: `res_${context.cartId}` }),
    next: 'chargePayment',
  }),
  chargePayment: action({
    runtime: 'server',
    dependsOn: ['reserveInventory'],
    run: async ({ context }) => ({ paymentId: `pay_${context.cartId}` }),
    next: 'confirm',
  }),
  confirm: view({
    runtime: 'client',
    dependsOn: ['chargePayment'],
    initial: { accepted: false },
    next: 'receipt',
  }),
  declined: final({
    runtime: 'client',
    dependsOn: ['approvalGate'],
    next: null,
  }),
  receipt: final({
    runtime: 'client',
    dependsOn: ['confirm'],
    next: null,
  }),
});

const hybridFlow = defineFlow({
  mode: 'hybrid',
  context: { cartId: 'cart_99', orderTotal: 150 } satisfies HybridContext,
  start: 'cart',
  steps: hybridSteps,
  final: ['receipt', 'declined'],
});

export const hybridOrchestrator = createOrchestrator(hybridFlow);

export async function runHybridExample() {
  await hybridOrchestrator.next(); // cart -> shipping
  await hybridOrchestrator.next(); // shipping -> approvalGate
  await hybridOrchestrator.runReady({ concurrency: 2 }); // server gate/actions

  if (hybridOrchestrator.current() === 'confirm') {
    await hybridOrchestrator.next(); // confirm -> receipt
  }
}
