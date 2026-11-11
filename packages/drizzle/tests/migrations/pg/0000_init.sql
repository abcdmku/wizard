CREATE TABLE "test_wizard_dedupe" (
	"run_key" text NOT NULL,
	"dedupe_id" text NOT NULL,
	"digest" text NOT NULL,
	"status" text NOT NULL,
	"claim_id" text NOT NULL,
	"owner_fence" text NOT NULL,
	"claimed_at_ms" bigint NOT NULL,
	"request" text,
	"result" text,
	"completed_at_ms" bigint,
	CONSTRAINT "test_wizard_dedupe_run_key_dedupe_id_pk" PRIMARY KEY("run_key","dedupe_id")
);
--> statement-breakpoint
CREATE TABLE "test_wizard_runs" (
	"run_key" text PRIMARY KEY NOT NULL,
	"fence_counter" bigint DEFAULT 0 NOT NULL,
	"claim_counter" bigint DEFAULT 0 NOT NULL,
	"owner_id" text,
	"fence" text,
	"lease_expires_at_ms" bigint,
	"snapshot_epoch" bigint,
	"snapshot_seq" bigint,
	"snapshot" text
);
--> statement-breakpoint
CREATE TABLE "test_wizard_timers" (
	"run_key" text NOT NULL,
	"timer_id" text NOT NULL,
	"due_at_ms" bigint NOT NULL,
	"expected_epoch" bigint NOT NULL,
	"expected_seq" bigint NOT NULL,
	"claim_id" text NOT NULL,
	"owner_fence" text NOT NULL,
	"claimed_until_ms" bigint NOT NULL,
	CONSTRAINT "test_wizard_timers_run_key_timer_id_pk" PRIMARY KEY("run_key","timer_id")
);
--> statement-breakpoint
ALTER TABLE "test_wizard_dedupe" ADD CONSTRAINT "test_wizard_dedupe_run_key_test_wizard_runs_run_key_fk" FOREIGN KEY ("run_key") REFERENCES "public"."test_wizard_runs"("run_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_wizard_timers" ADD CONSTRAINT "test_wizard_timers_run_key_test_wizard_runs_run_key_fk" FOREIGN KEY ("run_key") REFERENCES "public"."test_wizard_runs"("run_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_wizard_dedupe_retention_idx" ON "test_wizard_dedupe" USING btree ("status","completed_at_ms");--> statement-breakpoint
CREATE INDEX "test_wizard_timer_retention_idx" ON "test_wizard_timers" USING btree ("claimed_until_ms");