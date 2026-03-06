import {
  action,
  createOrchestrator,
  defineFlow,
  defineSteps,
  final,
  gate,
} from '../../core-contracts';

type DagContext = {
  batchId: string;
  normalizedCount: number;
};

const dagSteps = defineSteps({
  ingest: action({
    runtime: 'server',
    run: async ({ context }) => ({ source: `batch:${context.batchId}`, records: 1200 }),
    next: ['normalize', 'enrich'],
  }),
  normalize: action({
    runtime: 'server',
    dependsOn: ['ingest'],
    run: async ({ updateContext }) => {
      updateContext((draft) => {
        draft.normalizedCount = 1180;
      });
      return { normalized: 1180 };
    },
    next: 'qualityGate',
  }),
  enrich: action({
    runtime: 'server',
    dependsOn: ['ingest'],
    run: async () => ({ enriched: true }),
    next: 'qualityGate',
  }),
  qualityGate: gate({
    runtime: 'server',
    dependsOn: ['normalize', 'enrich'],
    next: ({ context }) => (context.normalizedCount > 0 ? 'persist' : 'failed'),
  }),
  persist: action({
    runtime: 'server',
    dependsOn: ['qualityGate'],
    run: async () => ({ persisted: true }),
    next: 'done',
  }),
  failed: final({
    runtime: 'server',
    dependsOn: ['qualityGate'],
    next: null,
  }),
  done: final({
    runtime: 'server',
    dependsOn: ['persist'],
    next: null,
  }),
});

const dagFlow = defineFlow({
  mode: 'dag',
  context: { batchId: 'batch_42', normalizedCount: 0 } satisfies DagContext,
  start: 'ingest',
  steps: dagSteps,
  final: ['done', 'failed'],
  maxConcurrency: 3,
});

export const dagOrchestrator = createOrchestrator(dagFlow);

export async function runDagExample() {
  await dagOrchestrator.runReady({ concurrency: 2 });
}
