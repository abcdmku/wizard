import { sql } from 'drizzle-orm'
import type { IntakeDrizzleDatabase } from './types'

export async function ensureIntakeSchema(db: IntakeDrizzleDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('openwizard:intake:schema'))`)

    await tx.execute(sql`
      create table if not exists intake_schema_migrations (
        version integer primary key,
        applied_at timestamptz not null default now()
      )
    `)

    await tx.execute(sql`
      create table if not exists intake_applications (
        id text primary key,
        tenant_id text not null,
        applicant_id text not null,
        applicant_name text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        terminal_at timestamptz,
        unique (tenant_id, id)
      )
    `)
    await tx.execute(sql`
      do $$
      begin
        if not exists (
          select 1
          from information_schema.columns
          where table_schema = current_schema()
            and table_name = 'intake_applications'
            and column_name = 'terminal_at'
        ) then
          alter table intake_applications add column terminal_at timestamptz;
        end if;
      end
      $$
    `)
    await tx.execute(sql`
      create index if not exists intake_applications_tenant_applicant_idx
      on intake_applications (tenant_id, applicant_id)
    `)
    await tx.execute(sql`
      create index if not exists intake_applications_active_idx
      on intake_applications (terminal_at, id)
    `)

    await createDurableTables(tx)
    await createRiskTables(tx)
    await createAuditTables(tx)

    await tx.execute(sql`
      insert into intake_schema_migrations (version)
      values (1)
      on conflict (version) do nothing
    `)
  })
}

async function createDurableTables(db: IntakeDrizzleDatabase): Promise<void> {
  await db.execute(sql`
    create table if not exists intake_wizard_runs (
      run_key text primary key,
      fence_counter bigint not null default 0,
      claim_counter bigint not null default 0,
      owner_id text,
      fence text,
      lease_expires_at_ms bigint,
      snapshot_epoch bigint,
      snapshot_seq bigint,
      snapshot text
    )
  `)
  await db.execute(sql`
    create table if not exists intake_wizard_dedupe (
      run_key text not null references intake_wizard_runs(run_key) on delete cascade,
      kind text not null,
      dedupe_id text not null,
      digest text not null,
      status text not null,
      claim_id text not null,
      owner_fence text not null,
      claimed_at_ms bigint not null,
      request text,
      result text,
      completed_at_ms bigint,
      primary key (run_key, kind, dedupe_id),
      check (kind in ('command', 'event')),
      check (status in ('pending', 'completed'))
    )
  `)
  await db.execute(sql`
    create index if not exists intake_wizard_dedupe_retention_idx
    on intake_wizard_dedupe (status, completed_at_ms)
  `)
  await db.execute(sql`
    create table if not exists intake_wizard_timers (
      run_key text not null references intake_wizard_runs(run_key) on delete cascade,
      timer_id text not null,
      due_at_ms bigint not null,
      expected_epoch bigint not null,
      expected_seq bigint not null,
      claim_id text not null,
      owner_fence text not null,
      claimed_until_ms bigint not null,
      primary key (run_key, timer_id)
    )
  `)
  await db.execute(sql`
    create index if not exists intake_wizard_timer_retention_idx
    on intake_wizard_timers (claimed_until_ms)
  `)
}

async function createRiskTables(db: IntakeDrizzleDatabase): Promise<void> {
  await db.execute(sql`
    create table if not exists intake_risk_jobs (
      id uuid primary key default gen_random_uuid(),
      application_id text not null,
      tenant_id text not null,
      fingerprint text not null,
      status text not null default 'queued',
      input jsonb not null,
      score integer,
      outcome text,
      reasons jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      available_at timestamptz not null default now(),
      started_at timestamptz,
      completed_at timestamptz,
      delivered_at timestamptz,
      lease_owner text,
      lease_expires_at timestamptz,
      attempt_count integer not null default 0,
      last_error text,
      unique (tenant_id, application_id, fingerprint),
      foreign key (tenant_id, application_id)
        references intake_applications(tenant_id, id) on delete cascade,
      check (status in ('queued', 'processing', 'completed')),
      check (outcome is null or outcome in ('approved', 'rejected', 'manual-review')),
      check (attempt_count >= 0)
    )
  `)
  await db.execute(sql`
    create index if not exists intake_risk_jobs_claim_idx
    on intake_risk_jobs (status, available_at, lease_expires_at)
  `)
  await db.execute(sql`
    create index if not exists intake_risk_jobs_delivery_idx
    on intake_risk_jobs (status, delivered_at, completed_at)
  `)
}

async function createAuditTables(db: IntakeDrizzleDatabase): Promise<void> {
  await db.execute(sql`
    create table if not exists intake_audit_events (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null,
      application_id text not null,
      actor text not null,
      action text not null,
      data jsonb not null,
      created_at timestamptz not null default now(),
      foreign key (tenant_id, application_id)
        references intake_applications(tenant_id, id) on delete cascade
    )
  `)
  await db.execute(sql`
    create index if not exists intake_audit_events_application_idx
    on intake_audit_events (tenant_id, application_id, created_at)
  `)
}
