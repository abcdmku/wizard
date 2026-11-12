CREATE TABLE IF NOT EXISTS dungeon_runs (
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

CREATE TABLE IF NOT EXISTS dungeon_dedupe (
  run_key text NOT NULL REFERENCES dungeon_runs(run_key) ON DELETE CASCADE,
  dedupe_id text NOT NULL,
  digest text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'applied', 'completed')),
  claim_id text NOT NULL,
  owner_fence text NOT NULL,
  claimed_at_ms bigint NOT NULL,
  request text,
  result text,
  completed_at_ms bigint,
  PRIMARY KEY (run_key, dedupe_id)
);

CREATE INDEX IF NOT EXISTS dungeon_dedupe_retention_idx
  ON dungeon_dedupe(status, completed_at_ms);

CREATE TABLE IF NOT EXISTS dungeon_timers (
  run_key text NOT NULL REFERENCES dungeon_runs(run_key) ON DELETE CASCADE,
  timer_id text NOT NULL,
  due_at_ms bigint NOT NULL,
  expected_epoch bigint NOT NULL,
  expected_seq bigint NOT NULL,
  claim_id text NOT NULL,
  owner_fence text NOT NULL,
  claimed_until_ms bigint NOT NULL,
  PRIMARY KEY (run_key, timer_id)
);

CREATE INDEX IF NOT EXISTS dungeon_timer_retention_idx
  ON dungeon_timers(claimed_until_ms);

CREATE TABLE IF NOT EXISTS dungeon_parties (
  party_id text PRIMARY KEY,
  run_key text NOT NULL UNIQUE REFERENCES dungeon_runs(run_key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
