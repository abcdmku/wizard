import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.integration.test.ts', 'tests/integration/**/*.test.ts'],
    env: {
      FULFILLMENT_INTEGRATION: '1',
      FULFILLMENT_ACME_CUSTOMER_TOKEN: 'customer-acme',
      FULFILLMENT_ACME_OPERATOR_TOKEN: 'operator-acme',
      FULFILLMENT_GLOBEX_CUSTOMER_TOKEN: 'customer-globex',
      FULFILLMENT_GLOBEX_OPERATOR_TOKEN: 'operator-globex',
    },
    hookTimeout: 60_000,
    testTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
