import type { Pool } from 'pg'

const migration = `
CREATE TABLE IF NOT EXISTS fulfillment_wizard_runs (
  run_key text PRIMARY KEY,
  fence_counter bigint NOT NULL DEFAULT 0,
  claim_counter bigint NOT NULL DEFAULT 0,
  owner_id text,
  fence text,
  lease_expires_at_ms bigint,
  snapshot_epoch bigint,
  snapshot_seq bigint,
  snapshot text
);
CREATE TABLE IF NOT EXISTS fulfillment_wizard_dedupe (
  run_key text NOT NULL REFERENCES fulfillment_wizard_runs(run_key) ON DELETE CASCADE,
  dedupe_id text NOT NULL,
  digest text NOT NULL,
  status text NOT NULL,
  claim_id text NOT NULL,
  owner_fence text NOT NULL,
  claimed_at_ms bigint NOT NULL,
  request text,
  result text,
  completed_at_ms bigint,
  PRIMARY KEY (run_key, dedupe_id)
);
CREATE INDEX IF NOT EXISTS fulfillment_wizard_dedupe_retention_idx
  ON fulfillment_wizard_dedupe(status, completed_at_ms);
CREATE TABLE IF NOT EXISTS fulfillment_wizard_timers (
  run_key text NOT NULL REFERENCES fulfillment_wizard_runs(run_key) ON DELETE CASCADE,
  timer_id text NOT NULL,
  due_at_ms bigint NOT NULL,
  expected_epoch bigint NOT NULL,
  expected_seq bigint NOT NULL,
  claim_id text NOT NULL,
  owner_fence text NOT NULL,
  claimed_until_ms bigint NOT NULL,
  PRIMARY KEY (run_key, timer_id)
);
CREATE INDEX IF NOT EXISTS fulfillment_wizard_timer_retention_idx
  ON fulfillment_wizard_timers(claimed_until_ms);
CREATE TABLE IF NOT EXISTS fulfillment_orders (
  order_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  customer_id text NOT NULL,
  status text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  create_idempotency_key text NOT NULL,
  request_digest text NOT NULL,
  initial_context jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, customer_id, create_idempotency_key)
);
CREATE INDEX IF NOT EXISTS fulfillment_orders_tenant_updated_idx
  ON fulfillment_orders(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS fulfillment_orders_active_idx
  ON fulfillment_orders(active) WHERE active = true;
CREATE TABLE IF NOT EXISTS fulfillment_callback_audit (
  event_id text NOT NULL,
  order_id uuid NOT NULL REFERENCES fulfillment_orders(order_id),
  partner text NOT NULL,
  digest text NOT NULL,
  outcome text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, partner, event_id)
);`

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(migration)
}
