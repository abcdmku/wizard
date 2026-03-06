import {
  action,
  createOrchestrator,
  defineFlow,
  defineSteps,
  final,
  gate,
} from '../../core-contracts';
import type {
  OrchestratorSnapshot,
  PersistenceAdapter,
} from '../../core-contracts';

type SagaContext = {
  orderId: string;
  paymentCaptured: boolean;
};

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

const sagaOrderId = 'ord_10';
const sagaRedisKey = `wizard:saga:${sagaOrderId}`;
const sagaInitialContext = {
  orderId: sagaOrderId,
  paymentCaptured: false,
} satisfies SagaContext;

// Replace this with a real Redis client (ioredis/node-redis) in production.
const redisStore = new Map<string, string>();
const redisExampleClient: RedisLike = {
  async get(key: string) {
    return redisStore.get(key) ?? null;
  },
  async set(key: string, value: string) {
    redisStore.set(key, value);
  },
  async del(key: string) {
    redisStore.delete(key);
  },
};

const sagaSteps = defineSteps({
  reserveInventory: action({
    runtime: 'server',
    run: async ({ context }) => ({ reservationId: `res_${context.orderId}` }),
    compensate: async ({ output }) => {
      if (output?.reservationId) {
        // release inventory reservation
      }
    },
    next: 'chargePayment',
  }),
  chargePayment: action({
    runtime: 'server',
    dependsOn: ['reserveInventory'],
    run: async ({ updateContext, context }) => {
      updateContext((draft) => {
        draft.paymentCaptured = true;
      });
      return { paymentId: `pay_${context.orderId}` };
    },
    compensate: async ({ output, updateContext }) => {
      if (output?.paymentId) {
        updateContext((draft) => {
          draft.paymentCaptured = false;
        });
        // issue refund
      }
    },
    next: 'createShipment',
  }),
  createShipment: action({
    runtime: 'server',
    dependsOn: ['chargePayment'],
    run: async ({ context }) => ({ shipmentId: `ship_${context.orderId}` }),
    compensate: async ({ output }) => {
      if (output?.shipmentId) {
        // cancel shipment
      }
    },
    next: 'settlementGate',
  }),
  settlementGate: gate({
    runtime: 'server',
    dependsOn: ['createShipment'],
    next: ({ context }) => (context.paymentCaptured ? 'completed' : 'failed'),
  }),
  completed: final({
    runtime: 'server',
    dependsOn: ['settlementGate'],
    next: null,
  }),
  failed: final({
    runtime: 'server',
    dependsOn: ['settlementGate'],
    next: null,
  }),
});

type SagaSteps = typeof sagaSteps;

const sagaFlow = defineFlow({
  mode: 'saga',
  context: sagaInitialContext,
  start: 'reserveInventory',
  steps: sagaSteps,
  final: ['completed', 'failed'],
  persistence: {
    adapter: createRedisPersistence(redisExampleClient, sagaRedisKey),
    key: sagaRedisKey,
    autoLoad: true,
    autoSave: 'on-change',
    clearOnFinal: true,
    debounceMs: 250,
  },
});

function createRedisPersistence(
  redis: RedisLike,
  key: string
): PersistenceAdapter<SagaContext, SagaSteps> {
  return {
    async load() {
      const raw = await redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as OrchestratorSnapshot<SagaContext, SagaSteps>;
    },
    async save(snapshot) {
      await redis.set(key, JSON.stringify(snapshot));
    },
    async clear() {
      await redis.del(key);
    },
  };
}

export const sagaOrchestrator = createOrchestrator(sagaFlow);

export async function hydrateSagaFromRedis() {
  await sagaOrchestrator.loadPersisted();
}

export async function syncSagaToRedis() {
  await sagaOrchestrator.savePersisted();
}

export async function runSagaExample() {
  await hydrateSagaFromRedis();

  try {
    await sagaOrchestrator.runReady();
  } catch {
    await sagaOrchestrator.compensate({ reason: 'automatic rollback after failure' });
  }

  await syncSagaToRedis();

  if (sagaOrchestrator.current() === 'completed') {
    await sagaOrchestrator.clearPersisted();
  }
}
