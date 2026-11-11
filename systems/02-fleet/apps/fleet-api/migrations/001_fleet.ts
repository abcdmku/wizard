export const fleetMigration001 = `
CREATE TABLE IF NOT EXISTS fleet_tenants (
  id text PRIMARY KEY,
  name text NOT NULL,
  timezone text NOT NULL,
  cursor integer NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fleet_tenants
  DROP COLUMN IF EXISTS bearer_token,
  DROP COLUMN IF EXISTS role;

CREATE TABLE IF NOT EXISTS fleet_principals (
  tenant_id text NOT NULL REFERENCES fleet_tenants(id) ON DELETE CASCADE,
  id text NOT NULL,
  bearer_token text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('dispatcher', 'manager', 'simulator', 'seed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, role)
);

CREATE TABLE IF NOT EXISTS fleet_vehicles (
  tenant_id text NOT NULL REFERENCES fleet_tenants(id) ON DELETE CASCADE,
  id text NOT NULL,
  label text NOT NULL,
  driver_name text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('available', 'en_route', 'delayed', 'offline')),
  position_x double precision NOT NULL,
  position_y double precision NOT NULL,
  heading double precision NOT NULL,
  active_delivery_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS fleet_deliveries (
  tenant_id text NOT NULL REFERENCES fleet_tenants(id) ON DELETE CASCADE,
  id text NOT NULL,
  reference text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('pending', 'in_transit', 'delayed', 'completed', 'cancelled')),
  customer text NOT NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  eta timestamptz NOT NULL,
  vehicle_id text,
  cargo jsonb NOT NULL,
  procedure jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT fleet_deliveries_vehicle_fk
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES fleet_vehicles(tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS fleet_deliveries_id_unique
  ON fleet_deliveries(id);
CREATE UNIQUE INDEX IF NOT EXISTS fleet_deliveries_tenant_reference_unique
  ON fleet_deliveries(tenant_id, reference);
CREATE INDEX IF NOT EXISTS fleet_deliveries_tenant_status_idx
  ON fleet_deliveries(tenant_id, status, id);

DO $fleet$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fleet_vehicles_active_delivery_fk'
  ) THEN
    ALTER TABLE fleet_vehicles
      ADD CONSTRAINT fleet_vehicles_active_delivery_fk
      FOREIGN KEY (tenant_id, active_delivery_id)
      REFERENCES fleet_deliveries(tenant_id, id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$fleet$;

CREATE TABLE IF NOT EXISTS fleet_telemetry (
  tenant_id text NOT NULL,
  vehicle_id text NOT NULL,
  command_id text NOT NULL,
  captured_at_ms bigint NOT NULL CHECK (captured_at_ms >= 0),
  position_x double precision NOT NULL,
  position_y double precision NOT NULL,
  heading double precision NOT NULL,
  battery_percent double precision NOT NULL
    CHECK (battery_percent >= 0 AND battery_percent <= 100),
  temp_c double precision NOT NULL,
  traffic text NOT NULL CHECK (traffic IN ('clear', 'moderate', 'heavy', 'blocked')),
  fault jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, vehicle_id, command_id),
  CONSTRAINT fleet_telemetry_vehicle_fk
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES fleet_vehicles(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS fleet_telemetry_vehicle_time_idx
  ON fleet_telemetry(tenant_id, vehicle_id, captured_at_ms DESC);

CREATE TABLE IF NOT EXISTS fleet_commands (
  tenant_id text NOT NULL,
  delivery_id text NOT NULL,
  command_id text NOT NULL,
  command_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted', 'completed', 'failed')),
  occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, delivery_id, command_id),
  CONSTRAINT fleet_commands_delivery_fk
    FOREIGN KEY (tenant_id, delivery_id)
    REFERENCES fleet_deliveries(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS fleet_commands_delivery_time_idx
  ON fleet_commands(tenant_id, delivery_id, occurred_at_ms);

CREATE TABLE IF NOT EXISTS fleet_events (
  tenant_id text NOT NULL,
  delivery_id text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, delivery_id, event_id),
  CONSTRAINT fleet_events_delivery_fk
    FOREIGN KEY (tenant_id, delivery_id)
    REFERENCES fleet_deliveries(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS fleet_events_delivery_time_idx
  ON fleet_events(tenant_id, delivery_id, occurred_at_ms);

CREATE TABLE IF NOT EXISTS fleet_delivery_runs (
  tenant_id text NOT NULL,
  delivery_id text NOT NULL,
  run_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminal')),
  terminal_status text
    CHECK (terminal_status IS NULL OR terminal_status IN ('completed', 'cancelled', 'failed')),
  started_at_ms bigint NOT NULL CHECK (started_at_ms >= 0),
  terminal_at_ms bigint,
  PRIMARY KEY (tenant_id, delivery_id),
  CONSTRAINT fleet_delivery_runs_delivery_fk
    FOREIGN KEY (tenant_id, delivery_id)
    REFERENCES fleet_deliveries(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS fleet_delivery_runs_active_idx
  ON fleet_delivery_runs(status, tenant_id, delivery_id);

CREATE TABLE IF NOT EXISTS fleet_escalations (
  tenant_id text NOT NULL,
  id text NOT NULL,
  delivery_id text NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  score double precision NOT NULL,
  band text NOT NULL DEFAULT 'P3' CHECK (band IN ('P3', 'P2', 'P1', 'P0')),
  created_at timestamptz NOT NULL,
  title text NOT NULL,
  detail text NOT NULL,
  allowed_actions jsonb NOT NULL,
  resolved_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT fleet_escalations_delivery_fk
    FOREIGN KEY (tenant_id, delivery_id)
    REFERENCES fleet_deliveries(tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE fleet_escalations
  ADD COLUMN IF NOT EXISTS band text NOT NULL DEFAULT 'P3'
  CHECK (band IN ('P3', 'P2', 'P1', 'P0'));
CREATE INDEX IF NOT EXISTS fleet_escalations_open_idx
  ON fleet_escalations(tenant_id, resolved_at, score DESC, created_at);

CREATE TABLE IF NOT EXISTS fleet_wizard_runs (
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

CREATE TABLE IF NOT EXISTS fleet_wizard_dedupe (
  run_key text NOT NULL REFERENCES fleet_wizard_runs(run_key) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('command', 'event')),
  dedupe_id text NOT NULL,
  digest text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'completed')),
  claim_id text NOT NULL,
  owner_fence text NOT NULL,
  claimed_at_ms bigint NOT NULL,
  request text,
  result text,
  completed_at_ms bigint,
  PRIMARY KEY (run_key, kind, dedupe_id)
);
CREATE INDEX IF NOT EXISTS fleet_wizard_dedupe_retention_idx
  ON fleet_wizard_dedupe(status, completed_at_ms);

CREATE TABLE IF NOT EXISTS fleet_wizard_timers (
  run_key text NOT NULL REFERENCES fleet_wizard_runs(run_key) ON DELETE CASCADE,
  timer_id text NOT NULL,
  due_at_ms bigint NOT NULL,
  expected_epoch bigint NOT NULL,
  expected_seq bigint NOT NULL,
  claim_id text NOT NULL,
  owner_fence text NOT NULL,
  claimed_until_ms bigint NOT NULL,
  PRIMARY KEY (run_key, timer_id)
);
CREATE INDEX IF NOT EXISTS fleet_wizard_timer_retention_idx
  ON fleet_wizard_timers(claimed_until_ms);
`
