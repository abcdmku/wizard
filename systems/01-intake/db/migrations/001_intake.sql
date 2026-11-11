-- The API runs ensureIntakeSchema() under an advisory lock. Keeping this
-- bootstrap migration deliberately small avoids a second, drifting definition
-- of the OpenWizard durable tables. Postgres initializes the extension before
-- the API creates intake_applications, intake_wizard_runs, dedupe, timers,
-- intake_risk_jobs, and intake_audit_events.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
